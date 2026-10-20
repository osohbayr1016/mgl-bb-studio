/** Builds the weight-mismatch rollup shown in the setup header.
 *
 *  Pure — the hook below just memoizes it. Extracted verbatim from
 *  `AdminProjectSetupPage.tsx` — no behavioural change. */
import type { ProjectTeamShare, Team, User } from '@/shared/types';

import { TEAM_NAME_BY_CODE, drawingTeamCode } from './teamMeta';
import type { SetupStore } from './useSetupStore';
import type { Block, Comp, Drawing, Task } from './types';
import {
  componentTaskSum,
  drawingTaskCount,
  drawingTaskSum,
  drawingUsesComponentWeights,
  num,
  sumW,
  weightStatus,
  weightStatusVsTarget,
} from './weights';

export function buildSetupSummary({
  blocks,
  drawings,
  components,
  tasks,
  users,
  teamShares,
  allTeams,
  t,
}: {
  blocks: Block[];
  drawings: Drawing[];
  components: Comp[];
  tasks: Task[];
  users: User[];
  teamShares: ProjectTeamShare[];
  allTeams: Team[];
  t: SetupStore['t'];
}) {
    // Block weight is "% within team" — every team's blocks must sum to
    // 100 independently. We compute the sums per team and report a
    // mismatch row per offending team rather than a single project-wide
    // figure (which would be 100 × teamCount).
    const blocksByTeam = new Map<number, Block[]>();
    for (const b of blocks) {
      if (b.team_id == null) continue;
      const arr = blocksByTeam.get(b.team_id) ?? [];
      arr.push(b);
      blocksByTeam.set(b.team_id, arr);
    }
    const teamNameOf = (teamId: number) =>
      teamShares.find((ts) => ts.team_id === teamId)?.team_code ??
      allTeams.find((t) => t.id === teamId)?.code ??
      `#${teamId}`;
    const mismatches: string[] = [];
    let teamsAllOk = blocksByTeam.size > 0;
    for (const [teamId, teamBlocks] of blocksByTeam) {
      const s = sumW(teamBlocks);
      if (weightStatus(s, teamBlocks.length) !== 'ok') {
        teamsAllOk = false;
        mismatches.push(
          `${teamNameOf(teamId)}: ${t('adminProjectSetupPage.mismatchBlocks', { sum: s.toFixed(1) })}`,
        );
      }
    }
    // Pass-through scalar for the completion-hero gauge: 100 when every
    // team's blocks sum cleanly, else the worst team's sum (so the gauge
    // visibly under-fills until the admin fixes the laggard).
    const blockSum =
      blocksByTeam.size === 0
        ? sumW(blocks)
        : teamsAllOk
          ? 100
          : Math.min(...Array.from(blocksByTeam.values()).map((bs) => sumW(bs)));
    // (Per-block drawing-sum check intentionally removed: drawings are
    // folders in the UI now, their weights are managed by the
    // auto-even-split on add. Surfacing a mismatch here would create a
    // warning the admin has no way to clear because the drawing
    // weight input is hidden.)
    // Per-drawing rollup. Two paths:
    //   • If ANY component under the drawing carries a weight (the optional
    //     intermediate tier is in use), validate two layers:
    //       (a) component weights sum to drawing weight,
    //       (b) tasks under each weighted component sum to that component's
    //           weight.
    //   • Otherwise (legacy "components are folders" mode), keep the simple
    //     rule: every task under the drawing must collectively sum to the
    //     drawing's weight, regardless of which component they're filed in.
    // We surface mismatches only when the drawing itself has a non-zero
    // target — otherwise the warning would be "0% / 0%" noise.
    for (const d of drawings) {
      const target = num(d.weight_percent);
      const taskN = drawingTaskCount(d.id, components, tasks);
      if (taskN === 0) continue;

      const usesCompWeights = drawingUsesComponentWeights(d.id, components);
      if (usesCompWeights) {
        const drawingComps = components.filter((c) => c.drawing_id === d.id);
        const compSum = sumW(drawingComps);
        if (weightStatusVsTarget(compSum, target, drawingComps.length) !== 'ok') {
          mismatches.push(
            `${d.name}: ${t('adminProjectSetupPage.mismatchComponents', {
              sum: compSum.toFixed(1),
              target: target.toFixed(1),
            })}`,
          );
        }
        for (const c of drawingComps) {
          const cTarget = num(c.weight_percent);
          if (cTarget <= 0) continue;
          const cTasks = tasks.filter((t) => t.component_id === c.id);
          if (cTasks.length === 0) continue;
          const cSum = componentTaskSum(c.id, tasks);
          if (weightStatusVsTarget(cSum, cTarget, cTasks.length) !== 'ok') {
            mismatches.push(
              `${d.name} › ${c.name}: ${t('adminProjectSetupPage.mismatchTasks', {
                sum: cSum.toFixed(1),
                target: cTarget.toFixed(1),
              })}`,
            );
          }
        }
      } else {
        const s = drawingTaskSum(d.id, components, tasks);
        if (weightStatusVsTarget(s, target, taskN) !== 'ok') {
          mismatches.push(
            `${d.name}: ${t('adminProjectSetupPage.mismatchDrawingTasks', {
              sum: s.toFixed(1),
              target: target.toFixed(1),
            })}`,
          );
        }
      }
    }

    // Project share by team. Block weight is "% within team", team_share
    // is "% within project", so a leaf task's share of the project is
    // (team_share/100) × (block_w/100) × task_w. Components don't
    // contribute — they're folders only.
    const userById = new Map(users.map((u) => [u.id, u]));
    const teamShareById = new Map(
      teamShares.map((ts) => [ts.team_id, Number(ts.share_percent || 0)]),
    );
    const byTeam = new Map<
      string,
      { code: string; name: string; taskCount: number; shareSum: number }
    >();
    const touchTeam = (code: string | null, share: number) => {
      const key = code ?? 'NONE';
      const name = code ? (TEAM_NAME_BY_CODE[code] ?? code) : t('adminProjectSetupPage.noTeam');
      const bucket = byTeam.get(key) ?? { code: key, name, taskCount: 0, shareSum: 0 };
      bucket.taskCount += 1;
      bucket.shareSum += share;
      byTeam.set(key, bucket);
    };

    for (const block of blocks) {
      const bw = num(block.weight_percent);
      const ts = block.team_id != null ? (teamShareById.get(block.team_id) ?? 0) : 0;
      for (const d of drawings.filter((x) => x.block_id === block.id)) {
        const drawCode = drawingTeamCode(d.name);
        for (const c of components.filter((x) => x.drawing_id === d.id)) {
          for (const t of tasks.filter((x) => x.component_id === c.id)) {
            const lw = num(t.weight_percent);
            const share = (ts * bw * lw) / 10000;
            if (t.assignees.length > 0) {
              const share_per = share / t.assignees.length;
              for (const a of t.assignees) {
                const u = userById.get(a.user_id);
                touchTeam(u?.team_code ?? drawCode, share_per);
              }
            } else {
              touchTeam(drawCode, share);
            }
          }
        }
      }
    }

    return {
      blockSum,
      mismatches,
      teamBuckets: Array.from(byTeam.values()).sort((a, b) => b.shareSum - a.shareSum),
    };
}
