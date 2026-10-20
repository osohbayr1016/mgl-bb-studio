/**
 * «ХУВААЛТЫГ ЦУЦЛАХ» (эзэн 2026-10-06, migration 0387) — хуваарилагдсан (managed) таскийг «огт хуваагаагүй, юу ч хийгээгүй» мэт
 * АНХНЫ байдалд буцаана.  Үндсэн таскийн «⋯» цэсний «Буцаах» хэсэгт.
 *
 *   УСТАНА (бүгд `task_unsplits`-д JSON архивтай):
 *     • `task_roots`, `task_allocations`, `task_contributions`, `task_credit_adjustments` — хуваалтын бүтэц, журнал;
 *     • хуваалтаас хойшх оноо — `user_points.contribution_id` нь энэ таскийн журналын мөр (ажлын оноо, залруулгын сөрөг мөр,
 *       жин тулгалтын нэмэлт мөр).  ⚠️ Хуваалтаас ӨМНӨХ (хуучин) оноо `contribution_id IS NULL` — seed нь түүнийг зөвхөн
 *       ЛАВЛАСАН тул ХӨНДӨГДӨХГҮЙ (сөрөг залруулга нь устахад хуучин оноо бүтнээрээ буцна);
 *     • явцын projection — `progress_entries.source IN ('alloc', 'alloc_adj')`.  Таскийн харагдах хувь нь хуучин сүүлийн бичлэг рүү
 *       буцна (`latestApprovedPctByCreatedAt`);
 *     • хуваалтаас хойш нэмэгдсэн `task_assignees` (`created_at >= task_roots.created_at`).
 *   ЗОГСОНО: таск дээр явж буй БҮХ албан таймер (сэшн УСТАХГҮЙ — цаг хэмжигдсэн хэвээр, админы тайланд).
 *   НУУГДАНА: зөвхөн хуваалтаас хойш оролцсон хүмүүсийн (хуучин бичлэг/оноо/хариуцагчийн мөргүй) таск дээрх цаг —
 *     `task_retractions` мөр (0386-ийн ИЖИЛ механизм, `notRetractedSql`).  Хуучин оролцогчдын цаг харагдсаар.
 *
 * Эрх: admin / senior / CEO — ямар ч үед.  Оролцогч (`task_allocations` мөртэй) — зөвхөн өөр хүний хийсэн ажил
 * (`kind='work'`) байхгүй үед (бусдын хийсэн хувь, оноог устгах эрхгүй) → 403 `UNSPLIT_OTHERS_WORK`.
 * Хуучин бүлгээс хөрвүүлсэн root (`task_conversion_members`, 0385) → 409 — тэдгээрийг админы хөрвүүлэлтийн «буцаах»-аар.
 *
 * Атомар: архивын INSERT нь `task_roots.revision`-ийг шалгадаг (CAS), бусад бүх statement тэр архивын мөр байхад л ажиллана —
 * зэрэгцээ өөрчлөлт орсон бол юу ч өөрчлөгдөхгүй, 409 `STALE_REVISION`.
 */
import { ceoUserId } from './ceo';
import { latestApprovedPctByCreatedAt } from './progressLatest';
import { closeSetSql } from './taskTimerStore';

const MANAGER_ROLES = new Set(['admin', 'senior']);

export type UnsplitFailure = { ok: false; status: 400 | 403 | 404 | 409; error: string; message: string };

export interface UnsplitResult {
  ok: true;
  task_id: number;
  replayed: boolean;
  removed_allocations: number;
  removed_points: number;
  removed_entries: number;
  timers_stopped: number;
  progress_before: number;
  progress_after: number;
}

const REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

async function pctOf(db: D1Database, taskId: number): Promise<number> {
  const r = await db
    .prepare(`SELECT COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS pct FROM tasks t WHERE t.id = ?1`)
    .bind(taskId)
    .first<{ pct: number }>();
  return Number(r?.pct) || 0;
}

async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const r = await db
    .prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?1`)
    .bind(name)
    .first<{ x: number }>()
    .catch(() => null);
  return r !== null;
}

export async function unsplitTask(
  db: D1Database,
  p: { actorId: number; actorRole: string; taskId: number; requestId: string; now?: Date },
): Promise<UnsplitResult | UnsplitFailure> {
  if (!REQUEST_ID_RE.test(p.requestId)) return { ok: false, status: 400, error: 'BAD_REQUEST_ID', message: 'request_id буруу' };

  // Давтан хүсэлт — анхны үр дүн (архивын мөр аль хэдийн бий).
  const done = await db
    .prepare('SELECT task_id, actor_id, progress_before, progress_after FROM task_unsplits WHERE request_id = ?1')
    .bind(p.requestId)
    .first<{ task_id: number; actor_id: number; progress_before: number | null; progress_after: number | null }>();
  if (done) {
    if (done.task_id !== p.taskId || done.actor_id !== p.actorId) {
      return { ok: false, status: 409, error: 'REQUEST_REUSED', message: 'request_id өөр үйлдэлд ашиглагдсан' };
    }
    return {
      ok: true,
      task_id: p.taskId,
      replayed: true,
      removed_allocations: 0,
      removed_points: 0,
      removed_entries: 0,
      timers_stopped: 0,
      progress_before: Number(done.progress_before) || 0,
      progress_after: Number(done.progress_after) || 0,
    };
  }

  const facts = await db
    .prepare(
      `SELECT pr.status AS project_status
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d ON d.id = c.drawing_id
         JOIN blocks b ON b.id = d.block_id
         JOIN projects pr ON pr.id = b.project_id
        WHERE t.id = ?1`,
    )
    .bind(p.taskId)
    .first<{ project_status: string }>();
  if (!facts) return { ok: false, status: 404, error: 'TASK_NOT_FOUND', message: 'Таск олдсонгүй' };

  const root = await db
    .prepare('SELECT * FROM task_roots WHERE task_id = ?1')
    .bind(p.taskId)
    .first<Record<string, unknown> & { revision: number; created_at: string; completed_at: string | null }>();
  if (!root) return { ok: false, status: 409, error: 'NOT_MANAGED', message: 'Энэ таск хуваагдаагүй байна.' };

  if (await tableExists(db, 'task_conversion_members')) {
    const conv = await db
      .prepare('SELECT 1 AS x FROM task_conversion_members WHERE task_id = ?1 LIMIT 1')
      .bind(p.taskId)
      .first<{ x: number }>();
    if (conv) {
      return {
        ok: false,
        status: 409,
        error: 'CONVERTED_ROOT',
        message: 'Энэ таск хуучин бүлгээс нэгтгэгдсэн — удирдлагын «Хөрвүүлэлт» хэсгээс буцаана.',
      };
    }
  }

  const [allocs, contributions] = await Promise.all([
    db.prepare('SELECT * FROM task_allocations WHERE task_id = ?1 ORDER BY ordinal').bind(p.taskId).all<Record<string, unknown> & { user_id: number }>(),
    db.prepare('SELECT * FROM task_contributions WHERE task_id = ?1 ORDER BY id').bind(p.taskId).all<Record<string, unknown> & { user_id: number; kind: string; units: number }>(),
  ]);
  const allocRows = allocs.results ?? [];
  const contribRows = contributions.results ?? [];

  const isManager = MANAGER_ROLES.has(p.actorRole) || p.actorId === ceoUserId();
  if (!isManager) {
    const participant = allocRows.some((a) => a.user_id === p.actorId);
    if (!participant) {
      return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Зөвхөн оролцогч эсвэл ахлах/админ хуваалтыг цуцална.' };
    }
    const othersWork = contribRows.some((c) => c.kind === 'work' && Number(c.units) > 0 && c.user_id !== p.actorId);
    if (othersWork) {
      return {
        ok: false,
        status: 403,
        error: 'UNSPLIT_OTHERS_WORK',
        message: 'Өөр хүн энэ таск дээр хувь оруулсан тул хуваалтыг зөвхөн ахлах/админ цуцална.',
      };
    }
  }
  if (facts.project_status !== 'active' && !isManager) {
    return { ok: false, status: 409, error: 'PROJECT_INACTIVE', message: 'Төсөл идэвхгүй тул хуваалтыг цуцлах боломжгүй.' };
  }

  const POINTS_WHERE = `contribution_id IN (SELECT id FROM task_contributions WHERE task_id = ?1)`;
  const ENTRIES_WHERE = `task_id = ?1 AND source IN ('alloc', 'alloc_adj')`;
  const [points, entries, before] = await Promise.all([
    db.prepare(`SELECT * FROM user_points WHERE ${POINTS_WHERE}`).bind(p.taskId).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM progress_entries WHERE ${ENTRIES_WHERE}`).bind(p.taskId).all<Record<string, unknown>>(),
    pctOf(db, p.taskId),
  ]);
  const pointRows = points.results ?? [];
  const entryRows = entries.results ?? [];

  // Хуваалтаас хойш л оролцсон хүмүүс (хуучин бичлэг / хуучин оноо / хуваалтаас өмнөх хариуцагчийн мөр БАЙХГҮЙ) — тэдний
  // таск дээрх цагийг нуух `task_retractions` мөр авна.  Хуучин оролцогчдын цаг харагдсаар.
  const allocUsers = [...new Set(allocRows.map((a) => a.user_id))];
  const hideUsers: number[] = [];
  for (const uid of allocUsers) {
    const legacy = await db
      .prepare(
        `SELECT
           EXISTS (SELECT 1 FROM progress_entries WHERE task_id = ?1 AND user_id = ?2
                     AND COALESCE(source, 'web') NOT IN ('alloc', 'alloc_adj')) AS e,
           EXISTS (SELECT 1 FROM user_points WHERE task_id = ?1 AND user_id = ?2 AND contribution_id IS NULL) AS pts,
           EXISTS (SELECT 1 FROM task_assignees WHERE task_id = ?1 AND user_id = ?2 AND created_at < ?3) AS a`,
      )
      .bind(p.taskId, uid, root.created_at)
      .first<{ e: number; pts: number; a: number }>();
    if (!legacy || (!legacy.e && !legacy.pts && !legacy.a)) hideUsers.push(uid);
  }

  const nowIso = (p.now ?? new Date()).toISOString();
  const rid = p.requestId;
  const stopReq = `unsplit:${rid}`;
  // ?9 = request_id — архивын мөр байгаа үед л (CAS амжсан) бусад statement ажиллана.
  const MARK = `EXISTS (SELECT 1 FROM task_unsplits WHERE request_id = ?9)`;
  const hasAdj = await tableExists(db, 'task_credit_adjustments');

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO task_unsplits
           (request_id, task_id, actor_id, unsplit_at, root_revision, root_json, allocations_json, contributions_json,
            points_json, entries_json, progress_before)
         SELECT ?9, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?10, ?11
          WHERE EXISTS (SELECT 1 FROM task_roots WHERE task_id = ?1 AND revision = ?4)`,
      )
      .bind(
        p.taskId,
        p.actorId,
        nowIso,
        root.revision,
        JSON.stringify(root),
        JSON.stringify(allocRows),
        JSON.stringify(contribRows),
        JSON.stringify(pointRows),
        rid,
        JSON.stringify(entryRows),
        before,
      ),
    // Явж буй БҮХ таймер (сэшн хэвээр).
    db
      .prepare(
        `UPDATE task_timer_sessions SET ${closeSetSql('?3')},
                end_reason = 'pause', ended_by = ?2, end_request_id = ?4, end_note = 'unsplit'
          WHERE task_id = ?1 AND ended_at IS NULL AND EXISTS (SELECT 1 FROM task_unsplits WHERE request_id = ?5)`,
      )
      .bind(p.taskId, p.actorId, nowIso, stopReq, rid),
    db
      .prepare(
        `INSERT INTO task_timer_events (user_id, actor_id, action, session_id, task_id, at, request_id, note)
         SELECT user_id, ?2, 'pause', id, task_id, ended_at, ?3, 'unsplit'
           FROM task_timer_sessions WHERE end_request_id = ?3 AND task_id = ?1`,
      )
      .bind(p.taskId, p.actorId, stopReq),
    // user_points.progress_entry_id → ON DELETE SET NULL тул оноог бичлэгээс ӨМНӨ.
    db.prepare(`DELETE FROM user_points WHERE ${POINTS_WHERE} AND ${MARK}`).bind(p.taskId, ...pad(7), rid),
    db.prepare(`DELETE FROM progress_entries WHERE ${ENTRIES_WHERE} AND ${MARK}`).bind(p.taskId, ...pad(7), rid),
    ...(hasAdj
      ? [db.prepare(`DELETE FROM task_credit_adjustments WHERE task_id = ?1 AND ${MARK}`).bind(p.taskId, ...pad(7), rid)]
      : []),
    db.prepare(`DELETE FROM task_contributions WHERE task_id = ?1 AND ${MARK}`).bind(p.taskId, ...pad(7), rid),
    db.prepare(`DELETE FROM task_allocations WHERE task_id = ?1 AND ${MARK}`).bind(p.taskId, ...pad(7), rid),
    // Хүнгүй хэсгүүд (0394) — root-той хамт алга болно (хийсэн/оноо байхгүй, зөвхөн нөөц).
    db.prepare(`DELETE FROM task_parts WHERE task_id = ?1 AND ${MARK}`).bind(p.taskId, ...pad(7), rid),
    db
      .prepare(`DELETE FROM task_assignees WHERE task_id = ?1 AND created_at >= ?2 AND ${MARK}`)
      .bind(p.taskId, root.created_at, ...pad(6), rid),
  ];
  for (const uid of hideUsers) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO task_retractions (task_id, user_id, retracted_at, entries_json, points_json, progress_before)
           SELECT ?1, ?2, ?3, '[]', '[]', ?4 WHERE ${MARK}`,
        )
        .bind(p.taskId, uid, nowIso, before, ...pad(4), rid),
    );
  }
  if (root.completed_at) {
    // Root 100% болж төсөл автоматаар архивлагдсан байж болно — хувь буурахад дахин нээнэ (гараар архивласныг хэзээ ч биш).
    stmts.push(
      db
        .prepare(
          `UPDATE projects SET status = 'active', auto_archived_at = NULL, updated_at = datetime('now')
            WHERE id = (SELECT b.project_id FROM tasks t JOIN components c ON c.id = t.component_id
                          JOIN drawings d ON d.id = c.drawing_id JOIN blocks b ON b.id = d.block_id WHERE t.id = ?1)
              AND status = 'archived' AND auto_archived_at IS NOT NULL AND ${MARK}`,
        )
        .bind(p.taskId, ...pad(7), rid),
    );
  }
  // Root-ийг ХАМГИЙН СҮҮЛД — дээрх statement-ууд архивын мөрөөр хамгаалагдсан тул дараалал нь зөвхөн уншихад ойлгомжтой.
  stmts.push(db.prepare(`DELETE FROM task_roots WHERE task_id = ?1 AND ${MARK}`).bind(p.taskId, ...pad(7), rid));

  const results = await db.batch(stmts);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    return {
      ok: false,
      status: 409,
      error: 'STALE_REVISION',
      message: 'Таск яг одоо өөрчлөгдсөн байна — хуудсаа шинэчлээд дахин оролдоно уу.',
    };
  }
  const timersStopped = results[1]?.meta.changes ?? 0;

  const after = await pctOf(db, p.taskId);
  await db.prepare('UPDATE task_unsplits SET progress_after = ?2 WHERE request_id = ?1').bind(rid, after).run();

  return {
    ok: true,
    task_id: p.taskId,
    replayed: false,
    removed_allocations: allocRows.length,
    removed_points: pointRows.length,
    removed_entries: entryRows.length,
    timers_stopped: timersStopped,
    progress_before: before,
    progress_after: after,
  };
}

/** `?9` (request_id)-ийг ижил байрлалд барихын тулд дунд нь хоосон bind (D1 нь ашиглагдаагүй дугаартай bind-ийг зөвшөөрдөг). */
function pad(n: number): null[] {
  return Array.from({ length: n }, () => null);
}
