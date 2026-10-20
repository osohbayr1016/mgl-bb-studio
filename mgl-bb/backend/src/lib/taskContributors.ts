/**
 * ТАСК/ТӨСЛИЙН ХУВЬ НЭМЭРЧ + АЖИЛЛАСАН ЦАГ — ажилтан бүрд харагдана (эзний шийдвэр 2026-10-02).
 *
 *   «Явцтай эсвэл бодитоор ажилласан хүн таймер pause болсон ч харагдана.  Bookmark нь ажилласан нотолгоо БИШ.»
 *   «ERP-д нэвтэрсэн ажилтнууд нэр, ажилласан цагийг харна — гаднаас нэвтрэлтгүй нийтэд нээхгүй.»
 *
 * ХУВЬ НЭМЭРЧ гэж тооцох нотолгоо (аль нэг):
 *   • managed таскийн хүчинтэй хийсэн хэсэг D > 0 (seed-ээр ирсэн ч);
 *   • тухайн таск дээрх цэвэр (буцаалтыг хассан) оноо > 0;
 *   • хуучин (managed биш) таскт өөрийн оруулсан явцын бичлэг (baseline, хуваалтын систем бичлэг, залруулгын
 *     projection ХАССАН);
 *   • тоологдсон (хүчингүй болгоогүй) албан таймерын цаг > 0 эсвэл ОДОО явж буй;
 *   • засварын цаг (`repair_entries.task_id`).
 * Нотолгоо БИШ: «Миний ажилд нэмэх» bookmark, `task_assignees` регистр, manager-ийн оруулсан baseline, хуваалтыг
 * хийсэн хүн (системийн `source='split'` бичлэгийн эзэн).
 *
 * ТАВАН ЭХ СУРВАЛЖ ХЭЗЭЭ Ч НЭГТГЭГДЭХГҮЙ: албан таймерын цаг (`official_closed_ms`), засварын цаг
 * (`repair_hours`), Revit-ийн далд цаг (энд ОГТ байхгүй).  Нэг мөрөнд хоёр талбар зэрэгцэн ирэх нь харуулах
 * газар бүр өөрийнхөө талбарыг сонгоно гэсэн үг — нийлбэр БИШ.
 *
 * Асуулга 6, төсөл бүрт НЭГ удаа — мөр бүрт дуудлага ХЭЗЭЭ Ч үгүй.
 */
import { officialMsSql, type OfficialLunch } from './taskTimer';
import { parseCompletionQuestions } from './taskCompletionAi';
import { rootDoneUnits, type RootAllocState } from './taskAllocation';
import { participantStatus, type ParticipantStatus } from './taskRootStore';

export type Evidence = 'progress' | 'credit' | 'time' | 'repair' | 'running';

export interface ContributorRow {
  user_id: number;
  full_name: string | null;
  profile_image: string | null;
  /** Тоологдсон (void-гүй, цайны цаг хассан) ДУУССАН албан цаг, мс. */
  official_closed_ms: number;
  /** Одоо явж буй сэшний эхлэл (ISO) — клиент `server_now`-оор харагдах цагийг нэмнэ. */
  running_since: string | null;
  /** Засварын цаг (`repair_entries`), хүн × таск — албан цагтай НЭГТГЭХГҮЙ. */
  repair_hours: number;
  /** Managed таскт: миний хийсэн / зорилт (нэгжээр) ба дугаар; бусад таскт null. */
  done_units: number | null;
  target_units: number | null;
  /** L — түгжигдсэн доод хязгаар (энгийн «−»-ийн хамгийн доод утга); managed биш таскт null. */
  floor_units: number | null;
  ordinal: number | null;
  /** Хуваарилалтын мөрийн өөрийн нэр (0393) — NULL бол үндсэн ажлын нэр. */
  label: string | null;
  allocation_status: ParticipantStatus | null;
  /** Хувь нэмэрч мөн (нотолгоотой) — харин зөвхөн ХУВААРИЛАГДСАН (D=0, цаггүй) хүн false. */
  contributor: boolean;
  evidence: Evidence[];
}

export interface ManagedSummary {
  revision: number;
  root_done_units: number;
  unattributed_units: number;
  /** U — хуваарилагдаагүй ирээдүйн ажил (хүнгүй хэсгүүдийг ОРУУЛСАН). */
  unallocated_units: number;
  /** Хүнгүй хэсгүүд (0394) — дугаарын дарааллаар; ▶ дарсан хүн авна. */
  parts: Array<{ part_id: number; ordinal: number; label: string; units: number }>;
}

export interface ProjectPerson {
  user_id: number;
  full_name: string | null;
  profile_image: string | null;
  official_closed_ms: number;
  running_since: string | null;
  tasks: number;
}

export interface ProjectContributors {
  /** task_id → хувь нэмэрчид (нотолгоотой эсвэл managed-ийн хуваарилагдсан). */
  tasks: Record<number, ContributorRow[]>;
  /** task_id → managed root-ийн тойм (managed биш таскт байхгүй). */
  managed: Record<number, ManagedSummary>;
  /** Төсөл × хүн: албан цагийн нийлбэр (таск тус бүрийн нийлбэр, хүнээр). */
  people: ProjectPerson[];
  /** Төслийн «дуусгах асуултууд» (өгөгдмөл нь сервер талд) — ажилтан өөрийн хэсгээ дуусгахад асууна. */
  completion_questions: ReturnType<typeof parseCompletionQuestions>;
}

const TASKS_IN_PROJECT = `SELECT t.id FROM tasks t
     JOIN components c ON c.id = t.component_id
     JOIN drawings d ON d.id = c.drawing_id
     JOIN blocks b ON b.id = d.block_id
    WHERE b.project_id = ?1`;

const NOT_VOID = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM task_timer_voids v WHERE v.session_id = ${alias}.id AND v.restored_at IS NULL)`;

/** «Таскийг буцаах» (0386): буцаасан хүний буцаасан агшнаас ӨМНӨ эхэлсэн сэшн таск дээр харагдахгүй (сэшн хэвээр).
 *  ⚠️ `taskTimerStore.ts` `notRetractedSql`-тэй ИЖИЛ. */
const NOT_RETRACTED = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM task_retractions r
                WHERE r.task_id = ${alias}.task_id AND r.user_id = ${alias}.user_id AND r.retracted_at >= ${alias}.started_at)`;

export async function loadProjectContributors(
  db: D1Database,
  projectId: number,
  lunch: OfficialLunch | null,
): Promise<ProjectContributors> {
  const [alloc, time, points, entries, repair, project, partRows] = await Promise.all([
    db
      .prepare(
        `SELECT r.task_id, r.revision, r.unattributed_units, r.unallocated_units,
                a.user_id, a.ordinal, a.target_units, a.done_units, a.floor_units, a.label
           FROM task_roots r
           LEFT JOIN task_allocations a ON a.task_id = r.task_id
          WHERE r.task_id IN (${TASKS_IN_PROJECT})
          ORDER BY r.task_id, a.ordinal`,
      )
      .bind(projectId)
      .all<{
        task_id: number;
        revision: number;
        unattributed_units: number;
        unallocated_units: number;
        user_id: number | null;
        ordinal: number | null;
        target_units: number | null;
        done_units: number | null;
        floor_units: number | null;
        label: string | null;
      }>()
      .catch(() => ({ results: [] as never[] })),
    // «Таскийг буцаах» (0386) шүүлт — `task_retractions` хараахан үүсээгүй орчинд шүүлтгүй уншина (цаг БҮГД алга болохгүй).
    (async () => {
      const q = (extra: string) =>
        db
          .prepare(
            `SELECT s.task_id, s.user_id,
                    SUM(CASE WHEN s.ended_at IS NOT NULL THEN ${officialMsSql('s', lunch)} ELSE 0 END) AS closed_ms,
                    MAX(CASE WHEN s.ended_at IS NULL THEN s.started_at END) AS running_since
               FROM task_timer_sessions s
              WHERE s.task_id IN (${TASKS_IN_PROJECT}) AND ${NOT_VOID('s')}${extra}
              GROUP BY s.task_id, s.user_id`,
          )
          .bind(projectId)
          .all<{ task_id: number; user_id: number; closed_ms: number | null; running_since: string | null }>();
      try {
        return await q(` AND ${NOT_RETRACTED('s')}`);
      } catch {
        return await q('').catch(() => ({ results: [] as never[] }));
      }
    })(),
    // `up.project_id = ?1` нь `idx_user_points_project`-ыг ашиглуулна — `user_points`-д task_id-ийн индекс БАЙХГҮЙ тул
    // түүнгүйгээр хүснэгт бүхэлдээ скан хийгдэнэ (D1 rows_read).  Явцын оноо үргэлж `project_id`-тэй (CHECK).
    db
      .prepare(
        `SELECT up.task_id, up.user_id, SUM(up.amount) AS net
           FROM user_points up
          WHERE up.project_id = ?1 AND up.task_id IN (${TASKS_IN_PROJECT}) AND up.source = 'progress'
          GROUP BY up.task_id, up.user_id
         HAVING SUM(up.amount) > 0.000001`,
      )
      .bind(projectId)
      .all<{ task_id: number; user_id: number; net: number }>(),
    db
      .prepare(
        `SELECT pe.task_id, pe.user_id
           FROM progress_entries pe
          WHERE pe.task_id IN (${TASKS_IN_PROJECT})
            AND pe.status = 'approved' AND pe.is_baseline = 0 AND pe.is_rest_day = 0 AND pe.defer_next_day = 0
            AND COALESCE(pe.source, 'web') NOT IN ('split', 'alloc_adj') AND pe.percentage > 0
          GROUP BY pe.task_id, pe.user_id`,
      )
      .bind(projectId)
      .all<{ task_id: number; user_id: number }>(),
    // Засварын цаг: 0341-ээс өмнө (task_id баганагүй) ч жагсаалт унах ёсгүй.
    db
      .prepare(
        `SELECT re.task_id, re.user_id, SUM(re.hours) AS hours
           FROM repair_entries re
          WHERE re.task_id IN (${TASKS_IN_PROJECT})
          GROUP BY re.task_id, re.user_id`,
      )
      .bind(projectId)
      .all<{ task_id: number; user_id: number; hours: number }>()
      .catch(() => ({ results: [] as never[] })),
    db
      .prepare('SELECT completion_questions FROM projects WHERE id = ?1')
      .bind(projectId)
      .first<{ completion_questions: string | null }>(),
    // Хүнгүй хэсгүүд (0394) — хүснэгт хараахан байхгүй орчинд хоосон.
    db
      .prepare(
        `SELECT p.task_id, p.id, p.ordinal, p.label, p.units
           FROM task_parts p
          WHERE p.task_id IN (${TASKS_IN_PROJECT})
          ORDER BY p.task_id, p.ordinal`,
      )
      .bind(projectId)
      .all<{ task_id: number; id: number; ordinal: number; label: string; units: number }>()
      .catch(() => ({ results: [] as never[] })),
  ]);

  type Acc = {
    done: number | null;
    target: number | null;
    floor: number | null;
    ordinal: number | null;
    label: string | null;
    allocated: boolean;
    closedMs: number;
    runningSince: string | null;
    repairHours: number;
    evidence: Set<Evidence>;
  };
  const byTask = new Map<number, Map<number, Acc>>();
  const get = (taskId: number, userId: number): Acc => {
    let m = byTask.get(taskId);
    if (!m) byTask.set(taskId, (m = new Map()));
    let a = m.get(userId);
    if (!a) {
      a = { done: null, target: null, floor: null, ordinal: null, label: null, allocated: false, closedMs: 0, runningSince: null, repairHours: 0, evidence: new Set() };
      m.set(userId, a);
    }
    return a;
  };

  const managed: Record<number, ManagedSummary> = {};
  const stateByTask = new Map<number, { rows: RootAllocState['rows']; unattributed: number; unallocated: number }>();
  for (const r of alloc.results ?? []) {
    let st = stateByTask.get(r.task_id);
    if (!st) {
      st = { rows: [], unattributed: r.unattributed_units, unallocated: r.unallocated_units };
      stateByTask.set(r.task_id, st);
      managed[r.task_id] = {
        revision: r.revision,
        root_done_units: 0,
        unattributed_units: r.unattributed_units,
        unallocated_units: r.unallocated_units,
        parts: [],
      };
    }
    if (r.user_id !== null) {
      st.rows.push({
        userId: r.user_id,
        doneUnits: r.done_units ?? 0,
        floorUnits: r.floor_units ?? 0,
        targetUnits: r.target_units ?? 0,
      });
      const a = get(r.task_id, r.user_id);
      a.done = r.done_units ?? 0;
      a.target = r.target_units ?? 0;
      a.floor = r.floor_units ?? 0;
      a.ordinal = r.ordinal;
      a.label = r.label;
      a.allocated = true;
      if ((r.done_units ?? 0) > 0) a.evidence.add('progress');
    }
  }
  for (const pr of partRows.results ?? []) {
    managed[pr.task_id]?.parts.push({ part_id: pr.id, ordinal: pr.ordinal, label: pr.label, units: pr.units });
  }
  for (const [taskId, st] of stateByTask) {
    managed[taskId]!.root_done_units = rootDoneUnits({
      unattributedUnits: st.unattributed,
      unallocatedUnits: st.unallocated,
      rows: st.rows,
    });
  }
  for (const t of time.results ?? []) {
    const ms = Number(t.closed_ms) || 0;
    if (ms <= 0 && !t.running_since) continue;
    const a = get(t.task_id, t.user_id);
    a.closedMs += ms;
    if (t.running_since) {
      a.runningSince = t.running_since;
      a.evidence.add('running');
    }
    if (ms > 0) a.evidence.add('time');
  }
  for (const p of points.results ?? []) get(p.task_id, p.user_id).evidence.add('credit');
  for (const e of entries.results ?? []) {
    // Managed таскт өөрийн хэсгийн нотолгоо D-ээс гарна (projection мөр нь root-ийн нийлбэр) — давхар тоолохгүй.
    if (managed[e.task_id]) continue;
    get(e.task_id, e.user_id).evidence.add('progress');
  }
  for (const r of repair.results ?? []) {
    const h = Number(r.hours) || 0;
    if (h <= 0) continue;
    const a = get(r.task_id, r.user_id);
    a.repairHours += h;
    a.evidence.add('repair');
  }

  const userIds = new Set<number>();
  for (const m of byTask.values()) for (const uid of m.keys()) userIds.add(uid);
  const names = new Map<number, { full_name: string | null; profile_image: string | null }>();
  const ids = [...userIds];
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, full_name, profile_image FROM users WHERE id IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<{ id: number; full_name: string | null; profile_image: string | null }>();
    for (const u of results ?? []) names.set(u.id, { full_name: u.full_name, profile_image: u.profile_image });
  }

  const tasks: Record<number, ContributorRow[]> = {};
  const peopleAcc = new Map<number, { closed: number; running: string | null; tasks: Set<number> }>();
  for (const [taskId, m] of byTask) {
    const list: ContributorRow[] = [];
    for (const [userId, a] of m) {
      const contributor = a.evidence.size > 0;
      // Хуваарилагдсан хэрнээ нотолгоогүй (D = 0, цаггүй) хүн жагсаалтад АЛЬ ХЭДИЙНЭЭ ордог — `contributor: false`.
      if (!contributor && !a.allocated) continue;
      const nm = names.get(userId);
      list.push({
        user_id: userId,
        full_name: nm?.full_name ?? null,
        profile_image: nm?.profile_image ?? null,
        official_closed_ms: a.closedMs,
        running_since: a.runningSince,
        repair_hours: Math.round(a.repairHours * 100) / 100,
        done_units: a.done,
        target_units: a.target,
        floor_units: a.floor,
        ordinal: a.ordinal,
        label: a.label,
        allocation_status: a.done !== null && a.target !== null ? participantStatus(a.done, a.target) : null,
        contributor,
        evidence: [...a.evidence],
      });
      if (a.closedMs > 0 || a.runningSince) {
        const p = peopleAcc.get(userId) ?? { closed: 0, running: null, tasks: new Set<number>() };
        p.closed += a.closedMs;
        if (a.runningSince && (p.running === null || a.runningSince < p.running)) p.running = a.runningSince;
        p.tasks.add(taskId);
        peopleAcc.set(userId, p);
      }
    }
    // Дараалал: managed бол хэсгийн дугаараар, бусад нь хамгийн их цагаар.
    list.sort((x, y) =>
      x.ordinal !== null && y.ordinal !== null
        ? x.ordinal - y.ordinal
        : y.official_closed_ms - x.official_closed_ms || x.user_id - y.user_id,
    );
    if (list.length > 0) tasks[taskId] = list;
  }
  const people: ProjectPerson[] = [...peopleAcc].map(([user_id, p]) => ({
    user_id,
    full_name: names.get(user_id)?.full_name ?? null,
    profile_image: names.get(user_id)?.profile_image ?? null,
    official_closed_ms: p.closed,
    running_since: p.running,
    tasks: p.tasks.size,
  }));
  people.sort((a, b) => b.official_closed_ms - a.official_closed_ms || a.user_id - b.user_id);
  return { tasks, managed, people, completion_questions: parseCompletionQuestions(project?.completion_questions) };
}
