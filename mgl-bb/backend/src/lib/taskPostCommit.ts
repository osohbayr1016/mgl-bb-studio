/**
 * ТАСКИЙН ХУВААРИЛТ — commit-ийн ДАРААХ үр дагавар ба хүсэлтийн агуулгын хурууны хээ (2026-10-05, migration 0383).
 *
 * ЯАГААД.  Managed мутаци нь НЭГ атом `db.batch` (marker-тэй, CAS, идемпотент) — харин дараах үр дагавар нь batch-ийн
 * ГАДНА, өөр хүснэгт/үйлчилгээ дээр: төсөл 100% болсон бол архивлах, залруулга анхны өдөрт бичигдсэн бол хуучирсан
 * employee snapshot-ыг дахин бодох, өнөөдрийн засварын цагийн блокийг дахин хуваарилах.  Өмнө нь тэдгээр алдаа нь
 * `console.error` болж алга болдог, мөн хариу алдагдаж клиент дахин оролдвол `replayed` нь тэдгээрийг ДАХИН АЖИЛЛУУЛАХГҮЙ
 * байв (`task_ops.post_status` багана 0377-д бий боловч НЭГ Ч УДАА бичигдээгүй).
 *
 * Одоо төлөвийн машин:
 *   marker бичигдэхэд `post_status = 'pending'` (+ `post_json` = үр дагаврын тодорхойлолт), үр дагавар бүрэн биелмэгц `done`.
 *   Алдвал `pending` хэвээр + `post_error` + `post_attempts`; 8 дахь алдаанд `failed` (аудитор харуулна, гараар шийднэ).
 *   Үр дагавар бүгд ИДЕМПОТЕНТ → ямар ч дахин ажиллуулалт аюулгүй: (а) ижил request_id дахин ирэхэд (`replayOf`),
 *   (б) cron-ийн sweep (`sweepPendingPostCommit`, одоо байгаа 2 минутын cron-ийн fail-safe салаанд — ШИНЭ cron илэрхийлэлгүй).
 *   AI-ийн дуусгалтын хураангуй нь ТОЙРОГ эффект (best-effort) — төлөвт орохгүй, зөвхөн анхны ажиллуулалтад.
 *
 * Хурууны хээ: `payloadHash` = SHA-256(каноник JSON).  Ижил request_id өөр агуулгатай ирвэл 409 REQUEST_REUSED.
 */
import type { Env } from '../types';
import { archiveProjectIfComplete } from '../routes/progress';
import { syncRepairDayIfMarked } from './repairDayStore';
import { refreshSnapshotsAfter } from './employeeSnapshot';
import { summarizeTaskCompletion } from './taskCompletionAi';
import { logTaskAlloc } from './taskAllocLog';

export interface PostEffects {
  taskId: number;
  projectId: number;
  owner: number;
  /** Үйлдэл хийгдсэн УБ өдөр (дахин ажиллуулахад ӨНӨӨДРИЙГ биш энэ өдрийг хэрэглэнэ). */
  today: string;
  completedRoot: boolean;
  increase: boolean;
  /** Буцаалт/сэргээлт анхны өдөрт бичигдсэн бол тэр өдрөөс хойших snapshot-ыг дахин бодно. */
  snapshotFrom: string | null;
  /**
   * Сэргээлт хаагдсан слайсыг ХУУЧИН жингээр буцааж нээдэг — managed оноог одоогийн жинтэй тэр даруй тулгана
   * (`taskCreditReweight.ts`).  0383-аас өмнөх мөрд байхгүй (= false).
   */
  reweight?: boolean;
}

export function hasPostEffects(e: PostEffects): boolean {
  return e.completedRoot || e.increase || e.reweight === true || (e.snapshotFrom !== null && e.snapshotFrom < e.today);
}

export interface PostCtx {
  db: D1Database;
  ai?: Env['AI'];
  waitUntil?: (p: Promise<unknown>) => void;
}

export const MAX_POST_ATTEMPTS = 8;

/** Алдаатай алхмуудын нэрс ([] = бүгд биелсэн). */
export async function runPostEffects(ctx: PostCtx, e: PostEffects, opts: { first: boolean }): Promise<string[]> {
  const failed: string[] = [];
  const { db } = ctx;
  if (e.increase) {
    try {
      await syncRepairDayIfMarked(db, e.owner, e.today);
    } catch (err) {
      failed.push('repair_day');
      console.error('[task-root] repair-day resync failed', err);
    }
  }
  if (e.reweight) {
    try {
      // Динамик import — `routes/progress.ts` ↔ энэ файл ↔ taskCreditReweight-ийн статик цикл үүсгэхгүй.
      const { reconcileTaskCredit } = await import('./taskCreditReweight');
      // force: энэ нь хаалганы шалгалтыг ДАВСАН мутацийн commit-ийн үр дагавар — дундуур төлөв солигдсон ч дуусгана.
      await reconcileTaskCredit({ db, ai: ctx.ai, force: true }, e.taskId, e.owner);
    } catch (err) {
      failed.push('reweight');
      console.error('[task-root] credit reweight failed', err);
    }
  }
  if (e.completedRoot) {
    if (opts.first && ctx.ai && ctx.waitUntil) {
      ctx.waitUntil(summarizeTaskCompletion({ db, ai: ctx.ai, taskId: e.taskId }));
    }
    try {
      await archiveProjectIfComplete(db, e.projectId);
    } catch (err) {
      failed.push('archive');
      console.error('[task-root] auto-archive failed', err);
    }
  }
  if (e.snapshotFrom && e.snapshotFrom < e.today) {
    try {
      await refreshSnapshotsAfter(db, e.snapshotFrom);
    } catch (err) {
      failed.push('snapshot');
      console.error('[task-root] snapshot refresh failed', err);
    }
  }
  return failed;
}

async function finalize(db: D1Database, requestId: string, failed: readonly string[], e: PostEffects): Promise<void> {
  try {
    if (failed.length === 0) {
      await db
        .prepare(
          `UPDATE task_ops SET post_status = 'done', post_error = NULL, post_attempts = post_attempts + 1
            WHERE request_id = ? AND post_status <> 'done'`,
        )
        .bind(requestId)
        .run();
      logTaskAlloc({ evt: 'post_commit', task_id: e.taskId, request_id: requestId, result: 'ok' });
    } else {
      await db
        .prepare(
          `UPDATE task_ops
              SET post_attempts = post_attempts + 1, post_error = ?1,
                  post_status = CASE WHEN post_attempts + 1 >= ?2 THEN 'failed' ELSE 'pending' END
            WHERE request_id = ?3 AND post_status <> 'done'`,
        )
        .bind(failed.join(',').slice(0, 200), MAX_POST_ATTEMPTS, requestId)
        .run();
      logTaskAlloc({ evt: 'post_commit', task_id: e.taskId, request_id: requestId, result: 'fail', code: failed.join(',') });
    }
  } catch (err) {
    console.error('[task-root] post_status update failed', err);
  }
}

/**
 * Үр дагаврыг ажиллуулж төлөвийг шинэчилнэ.  `waitUntil` байвал snapshot-ыг (удаан) хариунаас ТУСДАА ажиллуулна.
 * Архив, засварын цаг нь хариуны өмнө (UI шууд харна).
 */
export async function settlePostCommit(ctx: PostCtx, requestId: string, e: PostEffects, first: boolean): Promise<void> {
  if (!hasPostEffects(e)) return;
  const head = { ...e, snapshotFrom: null };
  const failedHead = await runPostEffects(ctx, head, { first });
  const tail = async (): Promise<void> => {
    const failedTail =
      e.snapshotFrom && e.snapshotFrom < e.today
        ? await runPostEffects(ctx, { ...e, increase: false, completedRoot: false }, { first: false })
        : [];
    await finalize(ctx.db, requestId, [...failedHead, ...failedTail], e);
  };
  if (ctx.waitUntil) ctx.waitUntil(tail());
  else await tail();
}

/** Ижил request_id дахин ирсэн (replay) — `pending` үр дагаврыг арын дэвсгэрт дахин ажиллуулна (хариуг удаашруулахгүй). */
export function retryPostCommit(ctx: PostCtx, requestId: string): void {
  const job = (async () => {
    const row = await ctx.db
      .prepare("SELECT post_json, post_attempts FROM task_ops WHERE request_id = ? AND post_status = 'pending'")
      .bind(requestId)
      .first<{ post_json: string | null; post_attempts: number }>();
    if (!row?.post_json) return;
    let effects: PostEffects;
    try {
      effects = JSON.parse(row.post_json) as PostEffects;
    } catch {
      return;
    }
    await settlePostCommit({ ...ctx, waitUntil: undefined }, requestId, effects, false);
  })().catch((err: unknown) => console.error('[task-root] post-commit retry failed', err));
  if (ctx.waitUntil) ctx.waitUntil(job);
}

/**
 * Cron-ийн fail-safe салаанд (2 минут тутам): 2+ минутын настай `pending` үр дагаврыг дахин ажиллуулна.
 * Нэг дуудлагад хамгийн ихдээ `limit` (өгөгдмөл 20) — cron-ын CPU хязгаарыг хамгаална.
 */
export async function sweepPendingPostCommit(
  env: Pick<Env, 'DB'> & { AI?: Env['AI'] },
  limit = 20,
): Promise<{ processed: number; done: number; failed: number }> {
  const { results } = await env.DB
    .prepare(
      `SELECT request_id, post_json FROM task_ops
        WHERE post_status = 'pending' AND post_attempts < ?1
          AND created_at < datetime('now', '-2 minutes')
        ORDER BY created_at LIMIT ?2`,
    )
    .bind(MAX_POST_ATTEMPTS, limit)
    .all<{ request_id: string; post_json: string | null }>();
  let done = 0;
  let failed = 0;
  for (const r of results ?? []) {
    let effects: PostEffects | null = null;
    try {
      effects = r.post_json ? (JSON.parse(r.post_json) as PostEffects) : null;
    } catch {
      effects = null;
    }
    if (!effects) {
      // post_json байхгүй/эвдэрсэн — хийх зүйлгүй, давхар оролдохгүйн тулд done болгож лог үлдээнэ.
      await env.DB.prepare("UPDATE task_ops SET post_status = 'failed', post_error = 'NO_POST_JSON' WHERE request_id = ?").bind(r.request_id).run();
      failed++;
      continue;
    }
    await settlePostCommit({ db: env.DB, ai: env.AI }, r.request_id, effects, false);
    const after = await env.DB.prepare('SELECT post_status FROM task_ops WHERE request_id = ?').bind(r.request_id).first<{ post_status: string }>();
    if (after?.post_status === 'done') done++;
    else failed++;
  }
  return { processed: (results ?? []).length, done, failed };
}

/* ------------------------------------------------------------------ */
/*  Хүсэлтийн агуулгын хурууны хээ                                       */
/* ------------------------------------------------------------------ */

/** Түлхүүрээр эрэмбэлсэн каноник JSON (undefined хасагдана) — ижил агуулга үргэлж ижил мөр. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export async function payloadHash(kind: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}|${canonicalJson(payload)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
