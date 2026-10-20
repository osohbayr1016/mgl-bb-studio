/** Chart aggregations for the retired "Графикууд" panel.
 *
 *  This used to be a `useMemo` inside `ProjectDetailPage` that was
 *  immediately `void`-ed — the tab was detached but the shaping logic was
 *  deliberately kept in source for when the dashboards team brings charts
 *  back. Moving it here keeps that history without recomputing on every
 *  render. Nothing calls it today; wire it into the charts tab when the
 *  panel returns. */
import type { ProjectDetailResponse } from '@/shared/types';

export function buildProjectChartData(
  data: ProjectDetailResponse | null,
  counts: { completed: number; inProgress: number; notStarted: number },
) {
  if (!data) return null;
  const blocks = data.blocks.map((b) => ({
    name: b.name.length > 18 ? b.name.slice(0, 18) + '…' : b.name,
    fullName: b.name,
    progress: Math.round(b.progress),
    remaining: Math.max(0, 100 - Math.round(b.progress)),
    weight: b.weight_percent,
    contribution: Math.round((b.progress * b.weight_percent) / 100),
  }));
  const drawings: { name: string; full: string; progress: number; block: string }[] = [];
  for (const b of data.blocks) {
    for (const d of b.drawings) {
      drawings.push({
        name: d.name.length > 24 ? d.name.slice(0, 24) + '…' : d.name,
        full: d.name,
        progress: Math.round(d.progress),
        block: b.name,
      });
    }
  }
  drawings.sort((a, b) => b.progress - a.progress);
  type TeamAcc = {
    code: string;
    name: string;
    taskCount: number;
    progWSum: number;
    wSum: number;
    members: Set<number>;
  };
  const teamMap = new Map<string, TeamAcc>();
  const touch = (key: string, name: string, w: number, p: number, userId: number) => {
    if (w <= 0) return;
    let entry = teamMap.get(key);
    if (!entry) {
      entry = { code: key, name, taskCount: 0, progWSum: 0, wSum: 0, members: new Set() };
      teamMap.set(key, entry);
    }
    entry.taskCount += 1;
    entry.progWSum += p * w;
    entry.wSum += w;
    entry.members.add(userId);
  };
  for (const b of data.blocks) {
    for (const d of b.drawings) {
      for (const c of d.components) {
        for (const t of c.tasks) {
          const assignees = t.assignees ?? [];
          if (assignees.length === 0) continue;
          const w = t.weight_percent;
          for (const a of assignees) {
            const key = a.team_code || 'OTHER';
            const name = a.team_name_mn || a.team_code || 'Бусад';
            touch(key, name, w, t.progress, a.user_id);
          }
        }
      }
    }
  }
  const teams = Array.from(teamMap.values())
    .map((t) => ({
      team: t.code,
      name: t.name,
      tasks: t.taskCount,
      members: t.members.size,
      avgProgress: t.wSum > 0 ? Math.round(t.progWSum / t.wSum) : 0,
    }))
    .sort((a, b) => b.tasks - a.tasks);
  const status = [
    { name: 'Дууссан', value: counts.completed, key: 'completed' },
    { name: 'Хийгдэж буй', value: counts.inProgress, key: 'in_progress' },
    { name: 'Эхлээгүй', value: counts.notStarted, key: 'not_started' },
  ];
  const overall = [
    /* ⚠️ `var(--primary)` нь ӨНГӨ БИШ, HSL гурвал (`217 59% 43%`) — SVG
       `fill`-д тэр чигээр нь өгөхөд утга хүчингүй болж цагираг ХАР болно.
       Tailwind-ийн `--color-*` токен нь бүрэн `hsl(...)`. */
    { name: 'progress', value: Math.round(data.project.progress), fill: 'var(--color-primary)' },
  ];
  return { blocks, drawings, teams, status, overall };
}
