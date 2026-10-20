/* ──────────────────────────────────────────────────────────────────────
 * Project categories — single source of truth on the backend.
 *
 * A project's category is the high-level "type of work" (working
 * drawings, repair, master plan, sketch, interior). Each category has a
 * fixed subset of teams (by team code) that are normally involved, plus
 * a default `share_percent` distribution. The shares only matter at
 * project-create time: when the admin picks a category and does not
 * supply an explicit `team_shares` roster, the POST /api/projects route
 * auto-seeds project_team_shares from the category default.
 *
 * AZ/ZA reuse the historical "ажилийн зураг" preset that already lives
 * on the frontend in lib/team-share-defaults.ts (BA 30 / BB 32 / HAS 11
 * / TSBU 8 / TSAH 10 / HD 5 / AU 4 — sums to 100). The other three
 * categories have small team rosters and use an equal split.
 *
 * Keep this file in sync with frontend/src/lib/project-categories.ts.
 * ────────────────────────────────────────────────────────────────── */

export type ProjectCategory = 'AZ' | 'ZA' | 'ET' | 'EZ' | 'IZ';

export const PROJECT_CATEGORY_CODES: ProjectCategory[] = ['AZ', 'ZA', 'ET', 'EZ', 'IZ'];

export interface ProjectCategoryDef {
  code: ProjectCategory;
  name_mn: string;
  name_en: string;
  /** Team codes that belong to this category, in display order. */
  teamCodes: string[];
  /** Default share_percent per team code. Must cover every entry of
   *  `teamCodes`; values should sum to 100. */
  shares: Record<string, number>;
}

const AZ_TEAMS = ['BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU'] as const;
const AZ_SHARES: Record<string, number> = {
  BA: 30,
  BB: 32,
  HAS: 11,
  TSBU: 8,
  TSAH: 10,
  HD: 5,
  AU: 4,
};

export const PROJECT_CATEGORIES: Record<ProjectCategory, ProjectCategoryDef> = {
  AZ: {
    code: 'AZ',
    name_mn: 'Ажлын зураг',
    name_en: 'Working drawings',
    teamCodes: [...AZ_TEAMS],
    shares: { ...AZ_SHARES },
  },
  ZA: {
    code: 'ZA',
    name_mn: 'Засвар',
    name_en: 'Repair',
    teamCodes: [...AZ_TEAMS],
    shares: { ...AZ_SHARES },
  },
  ET: {
    code: 'ET',
    name_mn: 'Ерөнхий төлөвлөгөө',
    name_en: 'Master plan',
    teamCodes: ['BA', 'BB'],
    shares: { BA: 50, BB: 50 },
  },
  EZ: {
    code: 'EZ',
    name_mn: 'Эскиз зураг',
    name_en: 'Sketch',
    teamCodes: ['BA', 'EZ'],
    shares: { BA: 50, EZ: 50 },
  },
  IZ: {
    code: 'IZ',
    name_mn: 'Интерьер зураг',
    name_en: 'Interior',
    teamCodes: ['BA', 'IZ'],
    shares: { BA: 50, IZ: 50 },
  },
};

export function isProjectCategory(v: unknown): v is ProjectCategory {
  return typeof v === 'string' && (PROJECT_CATEGORY_CODES as readonly string[]).includes(v);
}

/** Per-category default share roster (team code → share percent). The
 *  POST /api/projects handler resolves these codes to numeric team ids
 *  via a single `SELECT id, code FROM teams WHERE code IN (…)` lookup. */
export function getCategoryTeamShares(
  cat: ProjectCategory,
): Array<{ team_code: string; share_percent: number }> {
  const def = PROJECT_CATEGORIES[cat];
  return def.teamCodes.map((code) => ({
    team_code: code,
    share_percent: def.shares[code] ?? 0,
  }));
}
