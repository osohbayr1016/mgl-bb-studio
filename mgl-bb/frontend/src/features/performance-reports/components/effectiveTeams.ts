import type { ProjectDetailResponse } from '@/shared/types';
import type {
  PerformanceReport,
  TeamSnapshotItem,
} from '@/features/performance-reports/types/performanceReport';

/* =============================================================
 * Effective team list for the report renderer.
 * -------------------------------------------------------------
 * Issued reports carry a frozen snapshot in `report.team_progress`.
 * For drafts the column is empty — we'd otherwise show 0% across
 * the board. This helper falls back to a LIVE computation against
 * the current project hierarchy so the editor preview / draft PDF
 * shows real numbers (the same the snapshot would freeze on issue).
 *
 * Formula is the canonical one used everywhere (in-app "Багуудын
 * явц" panel + backend snapshotTeamProgress):
 *   per-team progress = Σ(task.progress × task.weight) / Σ(task.weight)
 * grouped by drawing NAME PREFIX (e.g. "HAS - …" → HAS), with a plain
 * average fallback when the team's task weights are all 0. This is
 * robust to rosters whose weights don't sum to 100 (which otherwise
 * collapsed a team to a few %).
 * ============================================================= */

/** Match a drawing's name to a team code by prefix (longest-first so
 *  "TSBU" beats a hypothetical "TS"). Mirrors ProjectDetailPage's
 *  drawingTeamCode for the prefix case. */
function drawingTeamCode(name: string, codes: string[]): string | null {
  const upper = (name ?? '').trim().toUpperCase();
  if (!upper) return null;
  for (const code of [...codes].sort((a, b) => b.length - a.length)) {
    if (
      upper.startsWith(`${code} `) ||
      upper.startsWith(`${code}-`) ||
      upper.startsWith(`${code}_`) ||
      upper === code
    )
      return code;
  }
  return null;
}

export function deriveEffectiveTeams(
  report: PerformanceReport,
  project: ProjectDetailResponse,
): TeamSnapshotItem[] {
  if (report.team_progress.length > 0) return report.team_progress;
  const shares = project.team_shares ?? [];
  const codes = shares.map((s) => s.team_code.toUpperCase());

  type Acc = { weightSum: number; weighted: number; plainSum: number; count: number };
  const acc = new Map<string, Acc>();
  for (const b of project.blocks ?? []) {
    for (const d of b.drawings ?? []) {
      const code = drawingTeamCode(d.name, codes);
      if (!code) continue;
      let row = acc.get(code);
      if (!row) {
        row = { weightSum: 0, weighted: 0, plainSum: 0, count: 0 };
        acc.set(code, row);
      }
      for (const c of d.components ?? []) {
        for (const t of c.tasks ?? []) {
          const w = Math.max(0, Number(t.weight_percent) || 0);
          const p = Number(t.progress) || 0;
          row.weightSum += w;
          row.weighted += p * w;
          row.plainSum += p;
          row.count += 1;
        }
      }
    }
  }

  return shares.map((s) => {
    const row = acc.get(s.team_code.toUpperCase());
    const progress =
      !row || row.count === 0
        ? 0
        : row.weightSum > 0
          ? row.weighted / row.weightSum
          : row.plainSum / row.count;
    return {
      team_id: s.team_id,
      team_code: s.team_code,
      team_name_mn: s.team_name_mn,
      share_percent: s.share_percent,
      progress: Math.round(progress * 100) / 100,
      task_count: row?.count ?? 0,
    };
  });
}
