/** Block-scoped aggregations: flattening, per-team rollups, timing and the
 *  team-tab ordering. Extracted verbatim from `ProjectDetailPage.tsx` when
 *  that file was split into per-component modules — no behavioural change. */
import type { AssigneeInfo, BlockProgress, ProjectDetailResponse } from '@/shared/types';

import { TEAM_PREFIX_CODES } from './constants';
import type { FlatBlockTask } from './types';

/** Flatten the block's hierarchy into a linear list of tasks for the
 *  breakdown tables. */
export function flattenBlockTasks(block: BlockProgress): FlatBlockTask[] {
  const out: FlatBlockTask[] = [];
  for (const d of block.drawings) {
    for (const c of d.components) {
      for (const t of c.tasks) {
        out.push({ task: t, drawing: d, componentName: c.name });
      }
    }
  }
  return out;
}

/** Collect all unique task assignees in a block, grouped by team. Uses
 *  `full_name` when an assignee has no team, so the column is never empty
 *  in production data. */
export function groupAssigneesByTeam(block: BlockProgress) {
  type TeamBucket = {
    key: string;
    label: string;
    code: string | null;
    people: Map<
      number,
      AssigneeInfo & { task_count: number; weighted_progress: number; weight_total: number }
    >;
  };
  const buckets = new Map<string, TeamBucket>();

  const addAssignee = (a: AssigneeInfo, taskWeight: number, taskProgress: number) => {
    const key = a.team_id != null ? `team:${a.team_id}` : 'none';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: a.team_name_mn ?? a.team_code ?? 'Багт хамаарахгүй',
        code: a.team_code,
        people: new Map(),
      };
      buckets.set(key, bucket);
    }
    const existing = bucket.people.get(a.user_id);
    if (existing) {
      existing.task_count += 1;
      existing.weighted_progress += taskProgress * taskWeight;
      existing.weight_total += taskWeight;
    } else {
      bucket.people.set(a.user_id, {
        ...a,
        task_count: 1,
        weighted_progress: taskProgress * taskWeight,
        weight_total: taskWeight,
      });
    }
  };

  for (const d of block.drawings) {
    for (const c of d.components) {
      for (const t of c.tasks) {
        const assignees = t.assignees ?? [];
        if (assignees.length === 0 && t.assigned_name) {
          addAssignee(
            {
              user_id: t.assigned_to ?? 0,
              full_name: t.assigned_name,
              profile_image: null,
              team_id: null,
              team_code: null,
              team_name_mn: null,
            },
            t.weight_percent,
            t.progress,
          );
        }
        for (const a of assignees) addAssignee(a, t.weight_percent, t.progress);
      }
    }
  }

  return Array.from(buckets.values())
    .map((b) => ({
      ...b,
      people: Array.from(b.people.values()).sort((a, b2) =>
        a.full_name.localeCompare(b2.full_name),
      ),
    }))
    .sort((a, b) => {
      // "No team" bucket always last.
      if (a.key === 'none' && b.key !== 'none') return 1;
      if (b.key === 'none' && a.key !== 'none') return -1;
      return a.label.localeCompare(b.label);
    });
}

/** Compute timing info for a block based on its earliest task start_date and
 *  latest task due_date. All dates compared in whole-day units. */
export function computeBlockTiming(block: BlockProgress) {
  let start: Date | null = null;
  let end: Date | null = null;
  for (const d of block.drawings) {
    for (const c of d.components) {
      for (const t of c.tasks) {
        if (t.start_date) {
          const dt = new Date(t.start_date);
          if (!Number.isNaN(dt.getTime())) {
            if (!start || dt < start) start = dt;
          }
        }
        if (t.due_date) {
          const dt = new Date(t.due_date);
          if (!Number.isNaN(dt.getTime())) {
            if (!end || dt > end) end = dt;
          }
        }
      }
    }
  }

  const DAY = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalDays =
    start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY) + 1) : null;

  // Elapsed: days from start to today (clamped to [0, totalDays]).
  let elapsedDays: number | null = null;
  if (start) {
    const raw = Math.floor((today.getTime() - start.getTime()) / DAY);
    elapsedDays = Math.max(0, raw);
    if (totalDays != null) elapsedDays = Math.min(elapsedDays, totalDays);
  }

  // Remaining: end - today, negative means overdue.
  let remainingDays: number | null = null;
  let overdueDays = 0;
  if (end) {
    const raw = Math.ceil((end.getTime() - today.getTime()) / DAY);
    if (raw < 0) {
      remainingDays = 0;
      overdueDays = -raw;
    } else remainingDays = raw;
  }

  // Expected progress if we followed schedule linearly — surfaces lag/ahead.
  const expectedProgress =
    totalDays && elapsedDays != null ? Math.min(100, (elapsedDays / totalDays) * 100) : null;

  return { start, end, totalDays, elapsedDays, remainingDays, overdueDays, expectedProgress };
}

/** Distinct team_ids that actually own at least one block. We only show
 *  tabs for teams with content, so a freshly-created project doesn't
 *  render an empty team strip until the admin assigns blocks.
 *
 *  Ordered by the fixed discipline order (BA, BB, TSAH, HAS, TSBU, HD, AU, …)
 *  — same vocabulary as DRAWING_DISCIPLINES — rather than whatever order the
 *  blocks happen to come back in, so the tabs read the same on every project.
 *  team_id → code comes from team_shares (the same lookup the tab strip
 *  render uses). Unknown codes fall to the end. */
export function orderedBlockTeamIds(
  blocks: BlockProgress[],
  teamShares: NonNullable<ProjectDetailResponse['team_shares']>,
): number[] {
  const blockTeamIds: number[] = [];
  const seen = new Set<number>();
  for (const b of blocks) {
    const tid = b.team_id ?? null;
    if (tid != null && !seen.has(tid)) {
      seen.add(tid);
      blockTeamIds.push(tid);
    }
  }
  const codeOrder = TEAM_PREFIX_CODES as readonly string[];
  const orderOf = (tid: number) => {
    const code = teamShares.find((s) => s.team_id === tid)?.team_code ?? null;
    const i = code ? codeOrder.indexOf(code) : -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  blockTeamIds.sort((a, b) => orderOf(a) - orderOf(b));
  return blockTeamIds;
}
