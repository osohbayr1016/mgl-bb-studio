/**
 * ХУВААРИЛАГДСАН (managed) ТАСКИЙН ОНООГ ЖИНГИЙН ӨӨРЧЛӨЛТИЙН ДАРАА ЖУРНАЛААС ДАХИН ТООЦОХ (2026-10-05, migration 0383).
 *
 * ЯАГААД.  Managed таскийн оноо нь бичигдсэн агшнийхаа коэффициентээр (`task.w × block.w × teamShare`) ба төвөгшлөөр
 * (`projects.complexity_pct`) ХӨЛДСӨН байдаг — `recalculateProjectPoints` managed таскийг зориуд ХӨНДДӨГГҮЙ (хуучин
 * replay нь журналыг эвдэх байсан).  Үр дагавар: админ таск/зураг/блок/багийн хувь, төвөгшлийг засахад төслийн ЯВЦ
 * (`calcProjectProgress`) шинэ жингээр шууд өөрчлөгдөх боловч managed таскийн оноо хуучин жингээр үлдэж, Σ `delta_pct` ≠
 * төслийн явц болдог (leaderboard-ийн `project_total_pct` үүнийг тэнцүү гэж үздэг).  Төвөгшил = 0 үед ажил ХИЙГДЭЖ
 * оноо 0 бичигдсэн слайс дараа нь төвөгшил засагдсан ч хэзээ ч оноо авдаггүй байв.
 *
 * ЗАГВАР (хуучин replay-тэй ЯГ ИЖИЛ утга учир, харин журналаар):
 *   • Слайс бүрийн оноо = `creditOf(paidOpen, одоогийн {coef, complexityPct})`, `paidOpen = units_open − free_open`.
 *   • ХЭН (user_id), АЛЬ ӨДӨР (awarded_at), АЛЬ СЛАЙС — хэвээр.  Анхны `user_points` мөрийг ХЭЗЭЭ Ч дарахгүй/устгахгүй:
 *     зөрүүг (шинэ − хуучин) НЭМЭЛТ мөр болгон слайсын анхны өдөрт бичнэ (`contribution_id` = слайс, `reverses_points_id`
 *     = NULL).  Ингэж өдөр/долоо хоног/сарын оноо, цаг хугацааны график ХУУЧИН replay шиг нэг хэмжээгээр ШИНЭ жингээр,
 *     ХЭН БИЧСЭН ӨДРИЙН ЗӨВ ВЕДРЭЭ хөдөлнө — өнөөдөрт нэг дор буухгүй, хэн нэгэнд шилжихгүй.
 *   • Слайсын `credit_open_*`-ыг шинэ утга болгоно — дараагийн буцаалт/залруулга зөв (шинэ) дүнг буцаана.  Хаагдсан
 *     (units_open = 0) слайс, залруулсан нэгж ХӨНДӨГДӨХГҮЙ (тэдний цэвэр нь 0).
 *   • Сэргээлт (restore) хаагдсан слайсыг хуучин жингээр буцааж нээдэг — тэр даруй дахин тооцно (`PostEffects.reweight`).
 *   • Идемпотент: хоёр дахь удаа ажиллуулахад зөрүү 0 → мөр бичигдэхгүй.  `task_credit_adjustments` нь аудит
 *     (өмнөх/дараах коэффициент, оноо, хэн, хэзээ); UNIQUE (run_id, contribution_id).
 *   • Root-ийн CAS: ажиллах бүрд `task_roots.revision` +1 — зэрэг явж буй буцаалт/залруулга (хуучин `credit_open_*`-оор
 *     бодсон) STALE болж аюулгүй дахин оролдоно (журналын дүн хэзээ ч зөрөхгүй).
 *
 * ХЯЗГААР (ил): `seed_attribution = 'uncertain' | 'empty'` root-ийн хуучин оноо слайсгүй (зөвхөн `slack_units` + хуучин
 * `user_points`) — журналаас дахин тооцох боломжгүй, тиймээс ХӨНДӨГДӨХГҮЙ.  Аудитор тэдгээрийг «drift тооцохгүй» гэж тэмдэглэнэ.
 */
import { loadRoot, loadTaskFacts, type RootSnapshot } from './taskRootStore';
import { creditOf, type CreditContext } from './taskCredit';
import { UNITS_PER_POINT } from './taskUnits';
import { logTaskAlloc } from './taskAllocLog';
import { settlePostCommit, type PostEffects, type PostCtx } from './taskPostCommit';
import { orgDateOfUtc } from './dailyAverage';
import { todayInUB } from './time';

/** Хөвөгч таслалтаас үүдэх хуурамч зөрүүг алгасах хязгаар. */
export const REWEIGHT_EPS = 1e-9;
/**
 * «Зөрсөн» гэж тооцох доод хэмжээ (оноо / төслийн %-ийн нэгжээр).  Хөрвүүлэлтийн seed нэгж нь `round(deltaPct/coef·1e4)` тул
 * бодит онооноос ~1e-5 орчим дугуйлалтаар зөрдөг — 1e-9 хүлцэл дээр хөрвүүлсэн БҮХ таск «зөрсөн» болж, анхны тулгалт бүр
 * дугуйлалтын шуугианыг шинэ `user_points` мөр болгож бичдэг байв.  1e-4 нь харагдах нарийвчлал (0.001%)-аас доош.
 */
export const REWEIGHT_NOISE = 1e-4;

export interface CreditSlice {
  id: number;
  taskId: number;
  userId: number;
  kind: 'work' | 'seed';
  unitsOpen: number;
  freeOpen: number;
  creditOpenAmount: number;
  creditOpenDeltaPct: number;
  awardedAt: string;
  progressEntryId: number | null;
}

export interface ReweightItem {
  contributionId: number;
  taskId: number;
  userId: number;
  awardedAt: string;
  progressEntryId: number | null;
  paidUnits: number;
  coefBefore: number;
  coefAfter: number;
  complexityBefore: number;
  complexityAfter: number;
  amountBefore: number;
  amountAfter: number;
  deltaPctBefore: number;
  deltaPctAfter: number;
  /** Нэмэх мөрийн дүн (шинэ − хуучин) — сөрөг байж болно. */
  amountDelta: number;
  deltaPctDelta: number;
}

/** Цэвэр төлөвлөгөө: аль слайсын оноо одоогийн коэффициенттэй зөрж байгааг тодорхойлно. */
export function planReweight(slices: readonly CreditSlice[], ctx: CreditContext): ReweightItem[] {
  const out: ReweightItem[] = [];
  for (const s of slices) {
    const paid = Math.max(0, s.unitsOpen - s.freeOpen);
    if (paid <= 0) continue;
    const target = creditOf(paid, ctx);
    const dAmount = target.amount - s.creditOpenAmount;
    const dDelta = target.deltaPct - s.creditOpenDeltaPct;
    if (Math.abs(dAmount) <= REWEIGHT_NOISE && Math.abs(dDelta) <= REWEIGHT_NOISE) continue;
    const pts = paid / UNITS_PER_POINT;
    const coefBefore = pts > 0 ? s.creditOpenDeltaPct / pts : 0;
    const complexityBefore = Math.abs(s.creditOpenDeltaPct) > REWEIGHT_EPS ? (s.creditOpenAmount / s.creditOpenDeltaPct) * 100 : 0;
    out.push({
      contributionId: s.id,
      taskId: s.taskId,
      userId: s.userId,
      awardedAt: s.awardedAt,
      progressEntryId: s.progressEntryId,
      paidUnits: paid,
      coefBefore,
      coefAfter: ctx.coef,
      complexityBefore,
      complexityAfter: Math.max(0, ctx.complexityPct),
      amountBefore: s.creditOpenAmount,
      amountAfter: target.amount,
      deltaPctBefore: s.creditOpenDeltaPct,
      deltaPctAfter: target.deltaPct,
      amountDelta: dAmount,
      deltaPctDelta: dDelta,
    });
  }
  return out;
}

export interface TaskReweightPreview {
  taskId: number;
  projectId: number;
  coef: number;
  complexityPct: number;
  items: ReweightItem[];
  totals: { amountDelta: number; deltaPctDelta: number; slices: number; users: number };
}

async function loadOpenCreditSlices(db: D1Database, taskId: number): Promise<CreditSlice[]> {
  const { results } = await db
    .prepare(
      `SELECT id, task_id, user_id, kind, units_open, free_open, credit_open_amount, credit_open_delta_pct,
              awarded_at, progress_entry_id
         FROM task_contributions
        WHERE task_id = ? AND kind IN ('work', 'seed') AND units_open > 0
        ORDER BY id`,
    )
    .bind(taskId)
    .all<{
      id: number;
      task_id: number;
      user_id: number;
      kind: 'work' | 'seed';
      units_open: number;
      free_open: number;
      credit_open_amount: number;
      credit_open_delta_pct: number;
      awarded_at: string;
      progress_entry_id: number | null;
    }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    taskId: r.task_id,
    userId: r.user_id,
    kind: r.kind,
    unitsOpen: r.units_open,
    freeOpen: r.free_open,
    creditOpenAmount: Number(r.credit_open_amount) || 0,
    creditOpenDeltaPct: Number(r.credit_open_delta_pct) || 0,
    awardedAt: r.awarded_at,
    progressEntryId: r.progress_entry_id,
  }));
}

export async function previewTaskReweight(db: D1Database, taskId: number): Promise<TaskReweightPreview | null> {
  const facts = await loadTaskFacts(db, taskId);
  if (!facts.exists) return null;
  const slices = await loadOpenCreditSlices(db, taskId);
  const items = planReweight(slices, { coef: facts.coef, complexityPct: facts.complexityPct });
  return {
    taskId,
    projectId: facts.projectId,
    coef: facts.coef,
    complexityPct: facts.complexityPct,
    items,
    totals: {
      amountDelta: items.reduce((s, i) => s + i.amountDelta, 0),
      deltaPctDelta: items.reduce((s, i) => s + i.deltaPctDelta, 0),
      slices: items.length,
      users: new Set(items.map((i) => i.userId)).size,
    },
  };
}

/** Төслийн БҮХ managed таскийн id. */
export async function managedTaskIdsOfProject(db: D1Database, projectId: number): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT r.task_id
         FROM task_roots r
         JOIN tasks t ON t.id = r.task_id
         JOIN components c ON c.id = t.component_id
         JOIN drawings d ON d.id = c.drawing_id
         JOIN blocks b ON b.id = d.block_id
        WHERE b.project_id = ?
        ORDER BY r.task_id`,
    )
    .bind(projectId)
    .all<{ task_id: number }>();
  return (results ?? []).map((r) => r.task_id);
}

export type ReweightOutcome =
  | { kind: 'noop'; taskId: number }
  | { kind: 'applied'; taskId: number; items: number; amountDelta: number; deltaPctDelta: number; users: number; requestId: string }
  | { kind: 'stale'; taskId: number }
  | { kind: 'skipped'; taskId: number; reason: 'NOT_MANAGED' | 'TASK_NOT_FOUND' | 'GATE_NOT_ENABLED' };

export interface ReweightCtx extends PostCtx {
  nowMs?: number;
  today?: string;
  /**
   * Идэвхжүүлэлтийн хаалгыг (`paused`/`disabled`) ТОЙРНО.  Автомат дуудагчид (жин засах, recalc) үүнгүйгээр `paused` үед оноо
   * бичихгүй — «paused = бүх managed бичилт зогсоно» (яаралтай түгжээ).  Админы тусгай `credit/reweight` болон ЯГ өнгөрсөн
   * (хаалганы шалгалтыг давсан) мутацийн commit-ийн дараах үр дагавар л `force` өгнө.
   */
  force?: boolean;
}

async function gateOpen(ctx: ReweightCtx): Promise<boolean> {
  if (ctx.force) return true;
  const { loadGate } = await import('./taskAllocGate');
  return (await loadGate(ctx.db)).state === 'enabled';
}

/**
 * Нэг managed таскийн оноог одоогийн жинтэй тулгана.  Зөрүүгүй бол ЮУ Ч бичихгүй.  Нэг атом batch, root-ийн CAS.
 * `requestId` өгөхгүй бол `rw-<task>-r<revision>` (төлөв бүрд өвөрмөц — ижил төлөвт зэрэг хоёр ажиллавал нэг нь л орно).
 */
export async function applyTaskReweight(
  ctx: ReweightCtx,
  actorId: number,
  taskId: number,
  opts: { requestId?: string } = {},
): Promise<ReweightOutcome> {
  const { db } = ctx;
  const snap: RootSnapshot | null = await loadRoot(db, taskId);
  if (!snap) return { kind: 'skipped', taskId, reason: 'NOT_MANAGED' };
  const facts = await loadTaskFacts(db, taskId);
  if (!facts.exists) return { kind: 'skipped', taskId, reason: 'TASK_NOT_FOUND' };
  const slices = await loadOpenCreditSlices(db, taskId);
  const items = planReweight(slices, { coef: facts.coef, complexityPct: facts.complexityPct });
  if (items.length === 0) return { kind: 'noop', taskId };

  const rid = opts.requestId ?? `rw-${taskId}-r${snap.root.revision}`;
  const revBefore = snap.root.revision;
  const revAfter = revBefore + 1;
  const nowIso = new Date(ctx.nowMs ?? Date.now()).toISOString();
  const today = ctx.today ?? todayInUB();
  const totals = {
    amountDelta: items.reduce((s, i) => s + i.amountDelta, 0),
    deltaPctDelta: items.reduce((s, i) => s + i.deltaPctDelta, 0),
    users: new Set(items.map((i) => i.userId)).size,
  };
  const earliest = items.map((i) => orgDateOfUtc(i.awardedAt)).sort()[0] ?? null;
  const effects: PostEffects = {
    taskId,
    projectId: facts.projectId,
    owner: actorId,
    today,
    completedRoot: false,
    increase: false,
    snapshotFrom: earliest,
  };
  const result = JSON.stringify({ kind: 'reweight', task_id: taskId, items: items.length, ...totals });

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO task_ops
           (request_id, task_id, user_id, kind, root_revision_before, root_revision_after,
            before_json, after_json, result_json, post_status, post_json)
         SELECT ?1, ?2, ?3, 'reweight', ?4, ?5, ?6, ?7, ?8, ?9, ?10
          WHERE EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = ?2 AND r.revision = ?4)`,
      )
      .bind(
        rid,
        taskId,
        actorId,
        revBefore,
        revAfter,
        JSON.stringify({ coef: items[0]!.coefBefore, complexity: items[0]!.complexityBefore }),
        JSON.stringify({ coef: facts.coef, complexity: facts.complexityPct }),
        result,
        earliest && earliest < today ? 'pending' : 'done',
        earliest && earliest < today ? JSON.stringify(effects) : null,
      ),
  ];
  const marker = '(SELECT 1 FROM task_ops WHERE request_id = ?1)';
  for (const it of items) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO user_points
             (user_id, project_id, task_id, progress_entry_id, amount, delta_pct, assignee_count, awarded_by,
              source, awarded_at, contribution_id, recorded_at)
           SELECT ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, 'progress', ?9, ?10, ?11
            WHERE EXISTS ${marker}`,
        )
        .bind(rid, it.userId, facts.projectId, taskId, it.progressEntryId, it.amountDelta, it.deltaPctDelta, actorId, it.awardedAt, it.contributionId, nowIso),
      db
        .prepare(
          `INSERT INTO task_credit_adjustments
             (run_id, task_id, contribution_id, user_id, points_id, coef_before, coef_after, complexity_before,
              complexity_after, amount_before, amount_after, delta_pct_before, delta_pct_after, awarded_at, actor_id)
           SELECT ?1, ?2, ?3, ?4,
                  (SELECT up.id FROM user_points up WHERE up.contribution_id = ?3 AND up.reverses_points_id IS NULL ORDER BY up.id DESC LIMIT 1),
                  ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
            WHERE EXISTS ${marker}`,
        )
        .bind(rid, taskId, it.contributionId, it.userId, it.coefBefore, it.coefAfter, it.complexityBefore, it.complexityAfter, it.amountBefore, it.amountAfter, it.deltaPctBefore, it.deltaPctAfter, it.awardedAt, actorId),
      db
        .prepare(
          `UPDATE task_contributions
              SET credit_open_amount = ?2, credit_open_delta_pct = ?3,
                  points_id = COALESCE(points_id, (SELECT up.id FROM user_points up
                                                    WHERE up.contribution_id = task_contributions.id AND up.reverses_points_id IS NULL
                                                    ORDER BY up.id LIMIT 1))
            WHERE id = ?4 AND EXISTS ${marker}`,
        )
        .bind(rid, it.amountAfter, it.deltaPctAfter, it.contributionId),
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE task_roots SET revision = ?2, updated_at = datetime('now')
          WHERE task_id = ?3 AND EXISTS ${marker}`,
      )
      .bind(rid, revAfter, taskId),
  );

  let applied = false;
  try {
    const res = await db.batch(stmts);
    applied = (res[0]?.meta.changes ?? 0) > 0;
  } catch (err) {
    // Ижил request_id аль хэдийн бичигдсэн (зэрэг ажиллалт) — marker PRIMARY KEY мөргөлдөж batch ROLLBACK.
    const prior = await db.prepare('SELECT 1 AS x FROM task_ops WHERE request_id = ?').bind(rid).first();
    if (prior) return { kind: 'noop', taskId };
    throw err;
  }
  if (!applied) return { kind: 'stale', taskId };
  logTaskAlloc({
    evt: 'reweight',
    op: 'reweight',
    task_id: taskId,
    project_id: facts.projectId,
    actor_id: actorId,
    request_id: rid,
    rev_before: revBefore,
    rev_after: revAfter,
    count: items.length,
    result: 'ok',
  });
  await settlePostCommit(ctx, rid, effects, true);
  return { kind: 'applied', taskId, items: items.length, ...totals, requestId: rid };
}

export interface ProjectReweightResult {
  projectId: number;
  tasks: number;
  applied: number;
  noop: number;
  stale: number;
  items: number;
  amountDelta: number;
  deltaPctDelta: number;
  /** Идэвхжүүлэлтийн хаалга `enabled` биш тул юу ч бичигдээгүй (аудитор `CREDIT_DRIFT` харуулна; админ дараа нь тулгана). */
  gateSkipped?: boolean;
}

/**
 * Төслийн БҮХ managed таскийг тулгана.  Managed таск байхгүй бол ГАНЦ хөнгөн асуулга (хуучин төслүүдэд нөлөөгүй).
 * STALE (зэрэг явж буй хэрэглэгчийн мутаци) бол нэг удаа дахин оролдоно.
 */
export async function reconcileProjectCredit(
  ctx: ReweightCtx,
  projectId: number,
  actorId = 0,
): Promise<ProjectReweightResult> {
  const out: ProjectReweightResult = { projectId, tasks: 0, applied: 0, noop: 0, stale: 0, items: 0, amountDelta: 0, deltaPctDelta: 0 };
  const ids = await managedTaskIdsOfProject(ctx.db, projectId);
  if (ids.length > 0 && !(await gateOpen(ctx))) return { ...out, tasks: ids.length, gateSkipped: true };
  out.tasks = ids.length;
  for (const id of ids) {
    let r = await applyTaskReweight(ctx, actorId, id);
    if (r.kind === 'stale') r = await applyTaskReweight(ctx, actorId, id);
    if (r.kind === 'applied') {
      out.applied++;
      out.items += r.items;
      out.amountDelta += r.amountDelta;
      out.deltaPctDelta += r.deltaPctDelta;
    } else if (r.kind === 'stale') out.stale++;
    else out.noop++;
  }
  return out;
}

/** Task-ээс төслийг олж тулгана (PUT task/drawing — нэг таск хөндөгдсөн үед). */
export async function reconcileTaskCredit(ctx: ReweightCtx, taskId: number, actorId = 0): Promise<ReweightOutcome> {
  if (!(await gateOpen(ctx))) {
    // Managed БИШ таск дээр хаалганы шалгалт хэрэггүй (хуучин зан хэвээр) — тэр үед applyTaskReweight өөрөө NOT_MANAGED буцаана.
    const snap = await loadRoot(ctx.db, taskId);
    return snap ? { kind: 'skipped', taskId, reason: 'GATE_NOT_ENABLED' } : { kind: 'skipped', taskId, reason: 'NOT_MANAGED' };
  }
  let r = await applyTaskReweight(ctx, actorId, taskId);
  if (r.kind === 'stale') r = await applyTaskReweight(ctx, actorId, taskId);
  return r;
}
