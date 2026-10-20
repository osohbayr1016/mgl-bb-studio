/** Flattens the project hierarchy into the task rows the overview renders,
 *  plus the per-team rollup and the block/team filters applied on top.
 *  Extracted from `ProjectDetailPage.tsx` when that file was split into
 *  per-component modules — no behavioural change. */
import { useMemo } from 'react';

import type { ProjectDetailResponse } from '@/shared/types';
import type { TeamProgressItem } from '@/features/projects/components/ProjectInfoTab';

import { DRAWING_DISCIPLINES, DRAWING_DISCIPLINE_LABEL } from './constants';
import { drawingTeamCode } from './helpers';
import type { FlatTask } from './types';

/** Таск «миний» эсэх — `flatTasks`-ийн хамрах хүрээ ба «Зөвхөн миний» шүүлт хоёр ЯГ
 *  ИЖИЛ дүрмийг хэрэглэх ёстой тул ганц газар.
 *
 *  `myTaskIds` (0370, `GET /progress/my-tasks/ids`) ачаалагдсан бол ЗӨВХӨН түүгээр —
 *  «Миний ажлууд»-тай ЯГ ижил олонлог (ажилласан ∪ «Миний ажилд нэмэх» − хассан).
 *  Ачаалагдаагүй / эрхгүй (админ) бол хуучин дүрэм: junction (`assignees`) ба
 *  хуучин скаляр (`assigned_to`). */
export function isMyTask(
  t: Pick<FlatTask, 'id' | 'assigned_to' | 'assignees'>,
  currentUserId: number | null,
  myTaskIds?: ReadonlySet<number> | null,
): boolean {
  if (myTaskIds) return myTaskIds.has(t.id);
  return (
    currentUserId != null &&
    (t.assigned_to === currentUserId || t.assignees.some((a) => a.user_id === currentUserId))
  );
}

export function useProjectTasks({
  data,
  isScopedUser,
  scopeTeamCodes,
  currentUserId,
  selectedBlockId,
  activeTeamId,
  mineOnly = false,
  myTaskIds = null,
}: {
  data: ProjectDetailResponse | null;
  isScopedUser: boolean;
  scopeTeamCodes: Set<string> | null;
  /** Нэвтэрсэн хэрэглэгч — өөрт нь хуваарилагдсан ажил зургийн багийн
   *  кодоос ҮЛ ХАМААРАН харагдах ёстой (доорх `flatTasks`). */
  currentUserId: number | null;
  selectedBlockId: number | null;
  activeTeamId: number | null;
  /** «Миний ажлууд»-аас `?mine=1`-ээр орсон үед: зөвхөн надад хуваарилагдсан
   *  таскууд.  Багийн pill-ийг ҮЛ ТООНО — миний таск өөр багийн блок дотор
   *  байж болох бөгөөд тэр нь pill-ийн ард алга болох ёсгүй. */
  mineOnly?: boolean;
  /** «Миний ажлууд»-ын таскууд (0370) — `isMyTask`-ийг үз. */
  myTaskIds?: ReadonlySet<number> | null;
}) {
  const allTasks = useMemo<FlatTask[]>(() => {
    if (!data) return [];
    const out: FlatTask[] = [];
    // Багийн төсөлд эзлэх хувь (project_team_shares.share_percent).  Блокийн
    // жин нь "багийн дотор" 100% болдог тул task-ийн ТӨСӨЛД эзлэх жинхэнэ
    // хувийг гаргахад багийн share-ээр хувиргах ёстой — backend-ийн
    // PROJECT_LIST_SQL-тэй ижил (share байхгүй бол 0).
    const shareByTeam = new Map<number, number>();
    for (const s of data.team_shares ?? []) shareByTeam.set(s.team_id, s.share_percent);
    for (const b of data.blocks) {
      const blockWeight = b.weight_percent ?? 0;
      const teamShare = b.team_id != null ? (shareByTeam.get(b.team_id) ?? 0) : 0;
      for (const d of b.drawings) {
        const drawingWeight = d.weight_percent ?? 0;
        const code = drawingTeamCode(d.name);
        for (const c of d.components) {
          for (const task of c.tasks) {
            // Үндсэн ажилд нэгтгэгдсэн хэсэг (хөрвүүлэлт, 0385) — жин 0, түүх хэвээр; явц/цаг/оноо root дээр тул харуулахгүй.
            if (task.retired_into != null) continue;
            // task.weight_percent is already on the team scale (it sums to
            // drawing.weight_percent inside a drawing, and to 100 across the
            // whole block). The task's share of the *project* is therefore its
            // within-team share (block.weight × task / 100) scaled by the
            // team's project share (project_team_shares) — matching the backend
            // rollup (PROJECT_LIST_SQL === calcProjectProgress). Зургийн жин
            // томьёонд ОРОХГҮЙ: p_drawing = Σ(t.w × pct)/d.w бөгөөд блокийн
            // түвшинд d.w-ээр буцаж үржигдэн товчлогддог.  ГЭХДЭЭ энэ нь
            // зөвхөн d.w ≠ 0 үед хүчинтэй — 0 төсөвтэй зургийн даалгавар
            // төсөлд 0 нэмэрлэдэг (backend-ийн `NULLIF(d.weight_percent, 0)`).
            const leafWeight = task.weight_percent;
            const projectShare =
              drawingWeight > 0 ? ((blockWeight * leafWeight) / 100) * (teamShare / 100) : 0;
            const drawingShare = drawingWeight > 0 ? (leafWeight * 100) / drawingWeight : 0;
            out.push({
              id: task.id,
              number: out.length + 1,
              block: b.name,
              drawing: d.name,
              component: c.name,
              name: task.name,
              assigned_name: task.assigned_name,
              assigned_to: task.assigned_to ?? null,
              assignees: task.assignees ?? [],
              teamCode: code,
              weight_percent: task.weight_percent,
              leafWeight,
              drawingShare,
              blockWeight,
              drawingWeight,
              projectShare,
              progress: task.progress,
              start_date: task.start_date ?? null,
              due_date: task.due_date ?? null,
              ai_completion_summary: task.ai_completion_summary ?? null,
              ai_completion_summary_at: task.ai_completion_summary_at ?? null,
              reviewer_name: task.reviewer_name ?? null,
              reviewed_at: task.reviewed_at ?? null,
            });
          }
        }
      }
    }
    return out;
  }, [data]);

  const teamProgress = useMemo<TeamProgressItem[]>(() => {
    type Acc = {
      code: string;
      label: string;
      taskCount: number;
      weightSum: number;
      weightedProgress: number;
      plainProgress: number;
    };
    const rows = new Map<string, Acc>();
    for (const discipline of DRAWING_DISCIPLINES) {
      rows.set(discipline.code, {
        code: discipline.code,
        label: discipline.label,
        taskCount: 0,
        weightSum: 0,
        weightedProgress: 0,
        plainProgress: 0,
      });
    }

    for (const task of allTasks) {
      const code = task.teamCode ?? 'OTHER';
      let row = rows.get(code);
      if (!row) {
        row = {
          code,
          label: DRAWING_DISCIPLINE_LABEL.get(code) ?? 'Бусад',
          taskCount: 0,
          weightSum: 0,
          weightedProgress: 0,
          plainProgress: 0,
        };
        rows.set(code, row);
      }
      const weight = Math.max(0, task.leafWeight || 0);
      row.taskCount += 1;
      row.weightSum += weight;
      row.weightedProgress += task.progress * weight;
      row.plainProgress += task.progress;
    }

    return Array.from(rows.values())
      .filter((row) => row.code !== 'OTHER' || row.taskCount > 0)
      .map((row) => ({
        code: row.code,
        label: row.label,
        taskCount: row.taskCount,
        progress: Math.round(
          row.weightSum > 0
            ? row.weightedProgress / row.weightSum
            : row.taskCount > 0
              ? row.plainProgress / row.taskCount
              : 0,
        ),
      }));
  }, [allTasks]);

  // Scoped task list — the single source of truth for everything rendered on
  // this page (hero counts, Overview, Charts). For scoped staff we show only
  // their team's drawing discipline: e.g. an HD member gets only HD tasks and
  // the task table renders only the HD tab. Admins see everything.
  //
  // 2026-09-17 fix: a task ASSIGNED to me is always visible, whatever the
  // drawing's prefix says.  Before this, a BB member with tasks on a BA
  // drawing (cross-team help, or a drawing with no recognisable prefix) saw
  // «0 / 26» and could not find their own work from the project page — the
  // banner promised «өөрт хуваарилагдсан» but the filter only read the
  // drawing code.  Both the junction (`assignees`) and the legacy scalar
  // (`assigned_to`) count, because old rows may carry only the scalar.
  const flatTasks = useMemo<FlatTask[]>(() => {
    if (!isScopedUser || !scopeTeamCodes) return allTasks;
    return allTasks.filter(
      (t) =>
        isMyTask(t, currentUserId, myTaskIds) ||
        (t.teamCode != null && scopeTeamCodes.has(t.teamCode)),
    );
  }, [allTasks, isScopedUser, scopeTeamCodes, currentUserId, myTaskIds]);

  // Миний таскууд — `flatTasks`-ийн дотроос (хамрах хүрээнээс гадуур юу ч
  // нэмэгдэхгүй).  «Зөвхөн миний» товчны тоо үүнээс авна.
  const myTasks = useMemo<FlatTask[]>(
    () => flatTasks.filter((t) => isMyTask(t, currentUserId, myTaskIds)),
    [flatTasks, currentUserId, myTaskIds],
  );

  const displayTasks = useMemo<FlatTask[]>(() => {
    // `?mine=1` — зөвхөн надад хуваарилагдсан таскууд.  Блок сонговол түүнтэй
    // огтлолцоно (хамгийн нарийн шүүлт), харин багийн pill үл тооцогдоно.
    const base = mineOnly ? myTasks : flatTasks;
    // Block selection wins: it's the most specific filter and is set by
    // the user clicking a block-card directly.
    if (selectedBlockId) {
      const selectedBlock = data?.blocks.find((b) => b.id === selectedBlockId);
      if (!selectedBlock) return base;
      const blockTaskIds = new Set<number>();
      for (const t of selectedBlock.tasks ?? []) blockTaskIds.add(t.id);
      for (const d of selectedBlock.drawings ?? []) {
        for (const c of d.components ?? []) {
          for (const t of c.tasks ?? []) blockTaskIds.add(t.id);
        }
      }
      return base.filter((t) => blockTaskIds.has(t.id));
    }
    if (mineOnly) return base;
    // The team-pill at the top of the overview also scopes the bottom
    // tasks table so the BA pill doesn't accidentally surface HAS / BB
    // / … tasks below it.
    // Багт оноогдоогүй (team_id NULL) блокийн ажил ямар ч pill-д
    // хамаарахгүй тул ҮРГЭЛЖ орно (ProjectOverviewTab.visibleBlocks-тэй ижил).
    if (activeTeamId != null && data) {
      const teamBlockIds = new Set(
        data.blocks
          .filter((b) => b.team_id === activeTeamId || b.team_id == null)
          .map((b) => b.id),
      );
      if (teamBlockIds.size === 0) return [];
      const taskIds = new Set<number>();
      for (const b of data.blocks) {
        if (!teamBlockIds.has(b.id)) continue;
        for (const t of b.tasks ?? []) taskIds.add(t.id);
        for (const d of b.drawings ?? []) {
          for (const c of d.components ?? []) {
            for (const t of c.tasks ?? []) taskIds.add(t.id);
          }
        }
      }
      return flatTasks.filter((t) => taskIds.has(t.id));
    }
    return flatTasks;
  }, [flatTasks, myTasks, mineOnly, selectedBlockId, data, activeTeamId]);

  const counts = useMemo(() => {
    const completed = displayTasks.filter((t) => t.progress >= 100).length;
    const inProgress = displayTasks.filter((t) => t.progress > 0 && t.progress < 100).length;
    const notStarted = displayTasks.filter((t) => t.progress === 0).length;
    return { total: displayTasks.length, completed, inProgress, notStarted };
  }, [displayTasks]);

  // Project headcount = explicitly-added members (project_members) UNION
  // anyone assigned to a task, deduped. Same definition as the backend
  // member_count (routes/projects.ts) and the AllTeamCharts report stat, so
  // every surface agrees.
  const assignedMemberCount = useMemo(() => {
    const ids = new Set<number>();
    for (const m of data?.members ?? []) ids.add(m.id);
    for (const t of allTasks) {
      for (const a of t.assignees) ids.add(a.user_id);
    }
    return ids.size;
  }, [allTasks, data?.members]);

  return {
    allTasks,
    teamProgress,
    flatTasks,
    myTasks,
    displayTasks,
    counts,
    assignedMemberCount,
  };
}
