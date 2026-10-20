/**
 * Хамтарсан ажлын оноо хуваах — `task_shares` (migration 0322).
 *
 * Нэг таскийг хэд хэдэн хүн хамт хийсэн бол таскийн ОНООГ (user_points)
 * хувиар хуваана.  Явцын % (rollup) энэ файлыг ОГТ уншихгүй — зөвхөн
 * `awardPointsForEntry` / `recalculateProjectPoints` / энд байгаа
 * `redistributeTaskPoints` гурав л хуваарилалтыг мэднэ.
 *
 * Мөргүй таск = илгээгч 100% (хуучин зан төлөв яг хэвээр).
 */

export interface CreditShare {
  user_id: number;
  /** 0 < fraction ≤ 1, нийлбэр нь яг 1. */
  fraction: number;
}

export interface TaskShareRow {
  task_id: number;
  user_id: number;
  share_percent: number;
}

/** Хуваарилалтын мөрүүдээс (нийлбэр 100 гэж таамаглахгүй — нормчилно)
 *  оноо авах хүмүүсийн жагсаалт.  0%-тэй мөр оноо авахгүй; бүх мөр 0 эсвэл
 *  мөр байхгүй бол `fallbackUserId` 100% (энэ нь илгээгч / baseline-ийн
 *  assigned_to).  `fallbackUserId` null бол хоосон жагсаалт. */
export function creditSplit(
  rows: ReadonlyArray<Pick<TaskShareRow, 'user_id' | 'share_percent'>>,
  fallbackUserId: number | null,
): CreditShare[] {
  const positive = rows.filter((r) => Number.isFinite(r.share_percent) && r.share_percent > 0);
  const total = positive.reduce((s, r) => s + r.share_percent, 0);
  if (positive.length === 0 || total <= 0) {
    return fallbackUserId === null ? [] : [{ user_id: fallbackUserId, fraction: 1 }];
  }
  return positive.map((r) => ({ user_id: r.user_id, fraction: r.share_percent / total }));
}

/** Нэг таскийн хуваарилалт (мөргүй бол []). */
export async function loadTaskShares(db: D1Database, taskId: number): Promise<TaskShareRow[]> {
  const { results } = await db
    .prepare(`SELECT task_id, user_id, share_percent FROM task_shares WHERE task_id = ?`)
    .bind(taskId)
    .all<TaskShareRow>();
  return results ?? [];
}

/** Төслийн бүх таскийн хуваарилалт нэг асуулгаар — `recalculateProjectPoints`
 *  N таск дээр N асуулга явуулахгүйн тулд. */
export async function loadProjectTaskShares(
  db: D1Database,
  projectId: number,
): Promise<Map<number, TaskShareRow[]>> {
  const { results } = await db
    .prepare(
      `SELECT ts.task_id, ts.user_id, ts.share_percent
         FROM task_shares ts
         JOIN tasks t      ON t.id = ts.task_id
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
        WHERE b.project_id = ?`,
    )
    .bind(projectId)
    .all<TaskShareRow>();
  const byTask = new Map<number, TaskShareRow[]>();
  for (const r of results ?? []) {
    const list = byTask.get(r.task_id) ?? [];
    list.push(r);
    byTask.set(r.task_id, list);
  }
  return byTask;
}

interface LedgerRow {
  id: number;
  project_id: number | null;
  progress_entry_id: number | null;
  amount: number;
  delta_pct: number;
  awarded_at: string;
  awarded_by: number | null;
}

/**
 * Таскийн ОДОО БАЙГАА `user_points` (source='progress') мөрүүдийг шинэ
 * хуваарилалтаар дахин бичнэ — хувь өөрчлөгдөхөд ретроактив үйлчлэх
 * тулгуур.  Entry тус бүрийн нийт amount / delta_pct-ийг (хуучин
 * хуваалтын мөрүүдийн нийлбэр) хадгалж, `awarded_at`/`awarded_by`-г
 * хэвээр үлдээнэ — тиймээс rolling-window leaderboard цаг хугацааны
 * байрлалаа алдахгүй, «хэний ажил байсан» (`awarded_by`) нь хуваалт
 * хасагдахад буцах fallback хэвээр.
 *
 * `recalculateProjectPoints`-ыг дуудахгүй байгаа нь зориудынх: тэр нь
 * төслийн БҮХ ledger-ийг одоогийн жингээр дахин барьдаг тул хувь хуваах
 * үйлдэл бусад хүний оноог хажуугаар нь өөрчлөх байсан.
 */
export async function redistributeTaskPoints(db: D1Database, taskId: number): Promise<void> {
  // Хуваарилагдсан (managed) таскийн оноо журналаас — энэ хуучин «task_shares» дахин хуваалт түүнийг ХЭЗЭЭ Ч хөндөхгүй.
  const managed = await db
    .prepare('SELECT 1 AS one FROM task_roots WHERE task_id = ?')
    .bind(taskId)
    .first<{ one: number }>()
    .catch(() => null);
  if (managed) return;
  const [{ results: ledger }, shares] = await Promise.all([
    db
      .prepare(
        `SELECT id, project_id, progress_entry_id, amount, delta_pct, awarded_at, awarded_by
           FROM user_points
          WHERE task_id = ? AND source = 'progress'
          ORDER BY awarded_at ASC, id ASC`,
      )
      .bind(taskId)
      .all<LedgerRow>(),
    loadTaskShares(db, taskId),
  ]);
  const rows = ledger ?? [];
  if (rows.length === 0) return;

  // Entry тус бүрд нэг бүлэг.  progress_entry_id NULL (entry устсан) мөр
  // бүлэглэгдэхгүй — өөрөө нэг бүлэг.
  const groups = new Map<
    string,
    { project_id: number | null; entry_id: number | null; amount: number; delta: number; awarded_at: string; awarded_by: number | null }
  >();
  for (const r of rows) {
    const key = r.progress_entry_id === null ? `row:${r.id}` : `entry:${r.progress_entry_id}`;
    const g = groups.get(key);
    if (g) {
      g.amount += r.amount;
      g.delta += r.delta_pct;
      if (r.awarded_at < g.awarded_at) g.awarded_at = r.awarded_at;
      if (g.awarded_by === null) g.awarded_by = r.awarded_by;
    } else {
      groups.set(key, {
        project_id: r.project_id,
        entry_id: r.progress_entry_id,
        amount: r.amount,
        delta: r.delta_pct,
        awarded_at: r.awarded_at,
        awarded_by: r.awarded_by,
      });
    }
  }

  const insert = db.prepare(
    `INSERT INTO user_points
       (user_id, project_id, task_id, progress_entry_id,
        amount, delta_pct, assignee_count, awarded_by, awarded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ops: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM user_points WHERE task_id = ? AND source = 'progress'`).bind(taskId),
  ];
  for (const g of groups.values()) {
    const split = creditSplit(shares, g.awarded_by);
    for (const s of split) {
      ops.push(
        insert.bind(
          s.user_id,
          g.project_id,
          taskId,
          g.entry_id,
          g.amount * s.fraction,
          g.delta * s.fraction,
          split.length,
          g.awarded_by,
          g.awarded_at,
        ),
      );
    }
  }
  await db.batch(ops);
}

// ---------------------------------------------------------------------------
// Эрхийн дүрэм (цэвэр, тесттэй) — GET/PUT /api/tasks/:id/shares ба /join
// хоёулаа ЭНЭ функцээс уншина, тиймээс «харах» ба «хадгалах» зөрөхгүй.
//
// 2026-09-18 (эзний шийдвэр): таскийн ОРОЛЦОГЧ бүр хувийг засна — эзэн ч,
// өөрөө нэгдсэн хүн (task_assignees.self_joined = 1, migration 0326) ч.
// Хоёулаа ярилцаад хийсэн хэмжээгээрээ хувиа оруулна.  Ялгаа нь ЖАГСААЛТ:
// эзэн (эсвэл admin/senior) л өөр хүн нэмж/хасна; өөрөө нэгдсэн хүн зөвхөн
// хувийн тоог өөрчилнө — эс тэгвэл хамтрагч эзнийг жагсаалтаас хасна.
// ---------------------------------------------------------------------------

export interface SharePolicyInput {
  role: string;
  userId: number;
  /** Өөрөө нэгдэх эрхтэй role (engineer/architect/senior/CEO) — routes/tasks.ts
   *  `canSelfClaim`-ийн үр дүн; энд role-оос дахин гаргахгүй (CEO hardcode). */
  canSelfClaim: boolean;
  /** Таскийн эзэд: task_shares.is_owner = 1, хуваалтгүй бол self_joined = 0
   *  assignees (бүгд өөрөө нэгдсэн бол бүх assignees). */
  owners: ReadonlySet<number>;
  /** Бүх оролцогч: task_assignees ∪ task_shares. */
  members: ReadonlySet<number>;
}

export interface SharePolicy {
  is_manager: boolean;
  is_owner: boolean;
  is_member: boolean;
  /** Хувийн тоог засах эрх. */
  can_edit: boolean;
  /** Жагсаалтад өөр хүн нэмэх, хамтрагч хасах, хуваалтыг бүхэлд нь арилгах. */
  can_add_others: boolean;
  /** Өөрийгөө нэмэх (POST /join) — оролцогч биш, эрхтэй role. */
  can_join: boolean;
}

export function shareEditPolicy(i: SharePolicyInput): SharePolicy {
  const is_manager = i.role === 'admin' || i.role === 'senior';
  const is_owner = i.owners.has(i.userId);
  const is_member = is_owner || i.members.has(i.userId);
  return {
    is_manager,
    is_owner,
    is_member,
    can_edit: is_manager || is_member,
    can_add_others: is_manager || is_owner,
    can_join: !is_member && i.canSelfClaim,
  };
}

export interface ShareListError {
  error: string;
  message: string;
  owner_id?: number;
}

/** PUT /shares-ийн жагсаалтын шалгалт (хувийн тоо, нэр дэвшигчийн эрх энд
 *  ОРОХГҮЙ — route дээр).  `wanted` хоосон = хуваалтыг арилгах. */
export function validateShareList(
  policy: SharePolicy,
  owners: ReadonlySet<number>,
  members: ReadonlySet<number>,
  wanted: ReadonlySet<number>,
): ShareListError | null {
  if (policy.is_manager) return null;
  if (!policy.can_edit) return { error: 'Forbidden', message: 'Зөвхөн таскийн оролцогч хувь хуваарилна' };
  if (!policy.can_add_others) {
    // Өөрөө нэгдсэн хамтрагч: жагсаалт = одоогийн оролцогчид ЯГ.
    const same = wanted.size === members.size && [...members].every((id) => wanted.has(id));
    if (!same) {
      return {
        error: 'members only',
        message: 'Хамтрагч жагсаалтыг өөрчлөхгүй — зөвхөн хувиа засна (нэмэх/хасахыг эзэн хийнэ)',
      };
    }
    return null;
  }
  if (wanted.size === 0) return null; // эзэн хуваалтыг арилгаж болно
  for (const ownerId of owners) {
    if (!wanted.has(ownerId)) {
      return { error: 'owner must stay in the list', message: 'Таскийн эзнийг хасах боломжгүй', owner_id: ownerId };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Нэгдэх үеийн АВТОМАТ хуваалт (эзний шийдвэр 2026-09-18, 2-р хэсэг):
// «таск 80% хийгдсэн бол шинээр нэгдсэн хүн үлдсэн 20%-ийг хийнэ — 50/50 биш».
// Хийгдсэн хувийг одоогийн гишүүд өөрсдийн одоогийн хувиар (хувьгүй бол
// тэнцүү) авч үлдэнэ, үлдсэн хувь шинэ хүнд.  0 < done < 100 үед Л — 0%-д
// хуваалт бичихгүй (илгээгч бүр өөрийнхөө ажлын оноог авна = ижил үр дүн,
// харин эзэн хожим өмнөх ажлаа бүртгэвэл оноо нь өөрт нь үлдэнэ), 100%-д
// шинэ хүнд өгөх зүйл алга — хоёуланд нь гараар тохирно.
// ---------------------------------------------------------------------------

export interface AutoSplitRow {
  user_id: number;
  share_percent: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function autoJoinSplit(
  donePct: number,
  existing: ReadonlyArray<{ user_id: number; share_percent?: number | null }>,
  newcomerId: number,
): AutoSplitRow[] | null {
  if (!Number.isFinite(donePct) || donePct <= 0 || donePct >= 100) return null;
  const members = existing.filter((m) => m.user_id !== newcomerId);
  if (members.length === 0) return null;
  const done = round2(donePct);
  const remaining = round2(100 - done);
  const hasWeights = members.some((m) => (m.share_percent ?? 0) > 0);
  const weights = members.map((m) => (hasWeights ? Math.max(0, m.share_percent ?? 0) : 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const rows: AutoSplitRow[] = members.map((m, i) => ({
    user_id: m.user_id,
    share_percent: round2((done * (weights[i] ?? 0)) / totalW),
  }));
  // Бутархайн үлдэгдлийг хамгийн том мөрөнд — нийлбэр ЯГ done.
  const diff = round2(done - rows.reduce((s, r) => s + r.share_percent, 0));
  if (diff !== 0) {
    const biggest = rows.reduce((a, b) => (b.share_percent > a.share_percent ? b : a));
    biggest.share_percent = round2(biggest.share_percent + diff);
  }
  rows.push({ user_id: newcomerId, share_percent: remaining });
  return rows;
}
