/**
 * Managed онооны тулгалт — унавал ДАРААЛАЛД үлдэж дахин оролдоно (migration 0402, 2026-10-15).
 *
 * Жин / төвөгшил засварын ДАРАА managed таскийн оноог журналаас шинэ коэффициенттэй тулгадаг
 * (`lib/taskCreditReweight.ts`).  Тэр алхам нь засварын хүсэлтийн ГАДНА (засвар аль хэдийн амжилттай), тиймээс
 * алдаа нь засварыг унагах ёсгүй — гэхдээ өмнө нь `console.error` болж ЧИМЭЭГҮЙ алга болдог байв.
 * Одоо: унасан (эсвэл зэрэг мутацийн улмаас 2 удаа `stale`) тулгалт `task_credit_reconcile_queue`-д мөр болно;
 * cron-ын fail-safe салаа (`sweepCreditReconcileQueue`, ШИНЭ cron илэрхийлэлгүй) 2+ минутын настай мөрийг дахин
 * ажиллуулна; `MAX_RECONCILE_ATTEMPTS` оролдлогод `failed` → аудитор `CREDIT_RECONCILE_FAILED`.
 *
 * Хаалга (`paused`/`disabled`)-ийн дүрэм ХЭВЭЭР: автомат тулгалт `force`-гүй, хаалттай үед бичихгүй (`skipped` /
 * `gateSkipped`) — энэ нь алдаа БИШ, мөр арилна (админы `credit/reweight` = force).
 *
 * Зэрэг ажиллагаа (migration 0404): мөр бүр `version`-тэй — enqueue бүр +1 ба эзэмшлийг чөлөөлнө.  Sweep мөрийг
 * ажиллуулахаасаа ӨМНӨ `claim_token`-оор эзэмшиж (давхцсан cron тик нэгийг нь л авна), дуусгахдаа
 * `version + claim_token`-оор НӨХЦӨЛТЭЙ устгана / оролдлого нэмнэ.  Тулгалтын үеэр шинэ ажил ирвэл хувилбар
 * өөрчлөгдөж устгал 0 мөр хөндөнө — шинэ ажил `pending` хэвээр үлдэж дараагийн sweep ажиллуулна.  Эзэмшил
 * `CLAIM_TTL_MINUTES`-аас хуучирвал (sweep унасан) дахин авагдана.
 *
 * ⚠️ `taskCreditReweight`-ийг ДИНАМИК import-оор — `routes/progress.ts` ↔ `taskPostCommit` ↔ `taskCreditReweight`
 *    статик цикл үүсгэхгүй (бусад дуудагчтай ижил).  Хүснэгт байхгүй (0402-оос өмнө) бол дараалал чимээгүй алгасна.
 */
import type { Env } from '../types';

export type ReconcileKind = 'task' | 'project';

export const MAX_RECONCILE_ATTEMPTS = 8;
/** Sweep унасан бол түүний эзэмшил энэ хугацааны дараа хүчингүй. */
export const CLAIM_TTL_MINUTES = 10;

/** Шинэ ажил = шинэ хувилбар; ажиллаж буй sweep-ийн эзэмшил чөлөөлөгдөнө (тэр нь хуучин хувилбараа л дуусгана). */
const CLAIM_RESET_SQL =
  ', version = task_credit_reconcile_queue.version + 1, claim_token = NULL, claimed_at = NULL';

const errText =(err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** Унасан тулгалтыг дараалалд бичнэ (эсвэл байгаа мөрийг шинэчилнэ).  Өөрөө ХЭЗЭЭ Ч throw хийхгүй. */
export async function enqueueCreditReconcile(
  db: D1Database,
  kind: ReconcileKind,
  targetId: number,
  actorId: number,
  error: string,
): Promise<void> {
  const upsert = (claimCols: boolean) =>
    db
      .prepare(
        `INSERT INTO task_credit_reconcile_queue (kind, target_id, actor_id, status, attempts, last_error)
         VALUES (?1, ?2, ?3, 'pending', 0, ?4)
         ON CONFLICT (kind, target_id) DO UPDATE SET
           actor_id = excluded.actor_id, status = 'pending', attempts = 0,
           last_error = excluded.last_error, updated_at = datetime('now')${claimCols ? CLAIM_RESET_SQL : ''}`,
      )
      .bind(kind, targetId, actorId, error.slice(0, 300))
      .run();
  try {
    await upsert(true);
  } catch (err) {
    // 0404-өөс өмнөх DB (deploy-ийн завсар) — ажлыг алдахгүйн тулд хувилбаргүйгээр бичнэ.
    if (/no such column/i.test(errText(err))) {
      try {
        await upsert(false);
        return;
      } catch (err2) {
        err = err2;
      }
    }
    console.error('[credit-queue] enqueue failed', { kind, targetId, err });
  }
}

/** Нэг удаагийн тулгалт.  `true` = дууссан (эсвэл хийх зүйлгүй), `false` = зэрэг мутацийн улмаас дуусаагүй. */
async function runOnce(db: D1Database, kind: ReconcileKind, targetId: number, actorId: number): Promise<boolean> {
  const { reconcileTaskCredit, reconcileProjectCredit } = await import('./taskCreditReweight');
  if (kind === 'task') {
    const r = await reconcileTaskCredit({ db }, targetId, actorId);
    return r.kind !== 'stale';
  }
  const r = await reconcileProjectCredit({ db }, targetId, actorId);
  return r.stale === 0;
}

/**
 * Жин засварын дараах тулгалт — route-ууд энийг дуудна (`try { reconcile… } catch { console.error }`-ийн оронд).
 * Унавал эсвэл дуусаагүй бол дараалалд бичнэ.  Хэзээ ч throw хийхгүй — засвар аль хэдийн амжилттай.
 */
export async function reconcileCreditOrEnqueue(
  db: D1Database,
  kind: ReconcileKind,
  targetId: number,
  actorId = 0,
): Promise<'done' | 'queued'> {
  try {
    if (await runOnce(db, kind, targetId, actorId)) return 'done';
    await enqueueCreditReconcile(db, kind, targetId, actorId, 'STALE');
  } catch (err) {
    console.error('[credit-queue] reconcile failed — queued for retry', { kind, targetId, err });
    await enqueueCreditReconcile(db, kind, targetId, actorId, errText(err));
  }
  return 'queued';
}

async function targetExists(db: D1Database, kind: ReconcileKind, id: number): Promise<boolean> {
  const sql = kind === 'task' ? 'SELECT 1 AS x FROM tasks WHERE id = ?' : 'SELECT 1 AS x FROM projects WHERE id = ?';
  return (await db.prepare(sql).bind(id).first()) !== null;
}

/**
 * Cron (2 минут тутам): 2+ минутын настай `pending` мөрийг дахин тулгана.  Нэг дуудлагад ≤ `limit`.
 * Мөр бүрийг эхлээд эзэмшинэ (өөр sweep эзэмшсэн бол алгасна).  Амжилт → мөр устна; алдаа → оролдлого +1,
 * `MAX_RECONCILE_ATTEMPTS`-д `failed`.  Хоёулаа уншсан `version` + өөрийн токеноор л — тэр хооронд шинэ ажил
 * ирсэн бол мөрийг хөндөхгүй.  `processed` = энэ sweep эзэмшсэн мөр.
 */
export async function sweepCreditReconcileQueue(
  env: Pick<Env, 'DB'>,
  limit = 20,
): Promise<{ processed: number; done: number; failed: number }> {
  type Row = { kind: string; target_id: number; actor_id: number; version: number };
  let rows: Row[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT kind, target_id, actor_id, version FROM task_credit_reconcile_queue
        WHERE status = 'pending' AND updated_at < datetime('now', '-2 minutes')
          AND (claim_token IS NULL OR claimed_at < datetime('now', ?1))
        ORDER BY updated_at LIMIT ?2`,
    )
      .bind(`-${CLAIM_TTL_MINUTES} minutes`, limit)
      .all<Row>();
    rows = results ?? [];
  } catch {
    return { processed: 0, done: 0, failed: 0 }; // 0402/0404-өөс өмнө — хүснэгт/багана байхгүй.
  }
  let processed = 0;
  let done = 0;
  let failed = 0;
  for (const r of rows) {
    const kind: ReconcileKind = r.kind === 'project' ? 'project' : 'task';
    const token = crypto.randomUUID();
    const claim = await env.DB.prepare(
      `UPDATE task_credit_reconcile_queue SET claim_token = ?1, claimed_at = datetime('now')
        WHERE kind = ?2 AND target_id = ?3 AND version = ?4 AND status = 'pending'
          AND (claim_token IS NULL OR claimed_at < datetime('now', ?5))`,
    )
      .bind(token, r.kind, r.target_id, r.version, `-${CLAIM_TTL_MINUTES} minutes`)
      .run();
    if ((claim.meta?.changes ?? 0) !== 1) continue; // өөр sweep эзэмшсэн, эсвэл шинэ ажил ирсэн
    processed++;

    let ok = false;
    let error = 'STALE';
    try {
      ok = !(await targetExists(env.DB, kind, r.target_id)) || (await runOnce(env.DB, kind, r.target_id, r.actor_id));
    } catch (err) {
      error = errText(err);
    }
    if (ok) {
      // Тулгалтын үеэр шинэ ажил ирсэн бол (`version` өссөн) мөр үлдэнэ — дараагийн sweep ажиллуулна.
      await env.DB.prepare(
        `DELETE FROM task_credit_reconcile_queue
          WHERE kind = ?1 AND target_id = ?2 AND version = ?3 AND claim_token = ?4`,
      )
        .bind(r.kind, r.target_id, r.version, token)
        .run();
      done++;
      continue;
    }
    // Шинэ ажлын оролдлогын тоолуурыг хуучин ажлын алдаа өсгөхгүй.
    await env.DB.prepare(
      `UPDATE task_credit_reconcile_queue
          SET attempts = attempts + 1, last_error = ?1, updated_at = datetime('now'),
              status = CASE WHEN attempts + 1 >= ?2 THEN 'failed' ELSE 'pending' END,
              claim_token = NULL, claimed_at = NULL
        WHERE kind = ?3 AND target_id = ?4 AND version = ?5 AND claim_token = ?6`,
    )
      .bind(error, MAX_RECONCILE_ATTEMPTS, r.kind, r.target_id, r.version, token)
      .run();
    failed++;
  }
  return { processed, done, failed };
}

/** Админы хуудас: хүлээгдэж буй / бүтэлгүйтсэн мөрийн тоо.  Хүснэгт байхгүй бол 0. */
export async function creditReconcileCounts(db: D1Database): Promise<{ pending: number; failed: number }> {
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
         FROM task_credit_reconcile_queue`,
    )
    .first<{ pending: number; failed: number }>()
    .catch(() => null);
  return { pending: Number(r?.pending) || 0, failed: Number(r?.failed) || 0 };
}
