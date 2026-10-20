/**
 * Stable project colour mapping for the team command-centre.
 *
 * The whole point of the page is "which team feeds which project today" — so a
 * single project must read as the *same* colour everywhere: the central gold
 * donut, its legend, every team's split bar and the accent stripe on each card.
 * `ActiveProjectPie` (the old table) coloured by array index, which let the
 * same project drift to different hues per row; we replace that with one
 * company-wide ranking so the colour is deterministic across surfaces.
 */

/** Brand gold for the central hero — decorative, not a status tone. */
export const GOLD = '#f5c451';

/** Distinct hues for the top projects.  Mirrors the Company Dashboard pie /
 *  project setup palette so the three surfaces stay visually consistent. */
export const PROJECT_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
] as const;

/** Everything past the top N collapses into one muted "others" bucket. */
export const OTHERS_COLOR = '#64748b'; // slate
export const OTHERS_ID = -1;

const TOP_N = PROJECT_PALETTE.length;

export interface ActiveProject {
  project_id: number;
  project_name: string;
  user_count: number;
  percent: number;
}

export interface ProjectShare {
  project_id: number;
  project_name: string;
  user_count: number;
  color: string;
}

export interface CompanySnapshot {
  /** Distinct people pointed at any project that day (a person on several
   *  projects counts once).  The per-project share counts can sum to more. */
  totalActivePeople: number;
  /** Distinct projects people were pointed at on the selected day. */
  activeProjectCount: number;
  /** Teams with at least one active project on the selected day. */
  activeTeamCount: number;
  /** Top projects (palette-coloured) plus a merged "others" tail, sorted desc. */
  shares: ProjectShare[];
  /** Resolve any project id to its assigned colour (others/unknown → muted). */
  colorOf: (projectId: number) => string;
}

type TeamLike = { active_projects?: ActiveProject[]; active_user_count?: number };

/**
 * Aggregate every team's daily active-project breakdown into one company-wide
 * snapshot, assigning each project a stable colour by global headcount rank.
 *
 * @param teams        the teams payload for the selected day
 * @param othersLabel  localised label for the merged tail ("Бусад" / "Others")
 * @param activeTeamCount  number of teams active that day (caller already knows it)
 */
export function buildCompanySnapshot(
  teams: TeamLike[],
  othersLabel: string,
  activeTeamCount: number,
): CompanySnapshot {
  // Fold all (team, project) rows into a per-project headcount.
  const byProject = new Map<number, { name: string; count: number }>();
  for (const team of teams) {
    for (const ap of team.active_projects ?? []) {
      const cur = byProject.get(ap.project_id);
      if (cur) cur.count += ap.user_count;
      else byProject.set(ap.project_id, { name: ap.project_name, count: ap.user_count });
    }
  }

  const ranked = [...byProject.entries()]
    .map(([project_id, v]) => ({ project_id, project_name: v.name, user_count: v.count }))
    .sort((a, b) => b.user_count - a.user_count || a.project_name.localeCompare(b.project_name));

  // Rank → colour.  Top N get distinct hues; the tail shares the muted colour.
  const colorMap = new Map<number, string>();
  ranked.forEach((p, i) => {
    colorMap.set(p.project_id, i < TOP_N ? PROJECT_PALETTE[i] ?? OTHERS_COLOR : OTHERS_COLOR);
  });

  // Per-team distinct counts sum to a company-wide distinct count because
  // attribution is by unique primary team.  Older cached payloads without the
  // field fall back to the per-project sum (which double-counts multi-project
  // people).
  const totalActivePeople = teams.reduce((sum, team) => sum + teamActivePeople(team), 0);

  const shares: ProjectShare[] = ranked.slice(0, TOP_N).map((p) => ({
    ...p,
    color: colorMap.get(p.project_id) ?? OTHERS_COLOR,
  }));
  const tail = ranked.slice(TOP_N).reduce((sum, p) => sum + p.user_count, 0);
  if (tail > 0) {
    shares.push({
      project_id: OTHERS_ID,
      project_name: othersLabel,
      user_count: tail,
      color: OTHERS_COLOR,
    });
  }

  return {
    totalActivePeople,
    activeProjectCount: ranked.length,
    activeTeamCount,
    shares,
    colorOf: (id: number) => colorMap.get(id) ?? OTHERS_COLOR,
  };
}

/** Distinct people pointed at projects for one team on the selected day.
 *  Falls back to the per-project sum for payloads predating the field. */
export function teamActivePeople(team: TeamLike): number {
  return (
    team.active_user_count ??
    (team.active_projects ?? []).reduce((sum, ap) => sum + ap.user_count, 0)
  );
}
