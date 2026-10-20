/* ──────────────────────────────────────────────────────────────────────
 * Project categories — frontend mirror of backend/src/lib/projectCategories.ts.
 *
 * A project's category is the high-level "type of work". The 5 codes
 * and their team rosters are hard-coded — they're used by:
 *   • the create-project dialog in ProjectsPage to require a category
 *     up front (the backend then auto-seeds project_team_shares).
 *   • the Projects list filter row + per-card badge.
 *   • AdminProjectSetupPage's +Баг dropdown, which surfaces the
 *     category's teams on top and the rest under "Бусад".
 * Keep this file in sync with the backend constant.
 * ────────────────────────────────────────────────────────────────── */

export type ProjectCategory = 'AZ' | 'ZA' | 'ET' | 'EZ' | 'IZ';

export const PROJECT_CATEGORY_CODES: ProjectCategory[] = ['AZ', 'ZA', 'ET', 'EZ', 'IZ'];

export interface ProjectCategoryDef {
  code: ProjectCategory;
  name_mn: string;
  name_en: string;
  /** Team codes that belong to this category, in display order. */
  teamCodes: string[];
  /** Default share_percent per team code; sums to 100. Used by
   *  AdminProjectSetupPage's "Ангиллын багуудыг нэмэх" helper to seed
   *  any team that's missing from an existing project's roster. */
  shares: Record<string, number>;
}

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
    teamCodes: ['BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU'],
    shares: { ...AZ_SHARES },
  },
  ZA: {
    code: 'ZA',
    name_mn: 'Засвар',
    name_en: 'Repair',
    teamCodes: ['BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU'],
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

export function categoryName(
  cat: ProjectCategory | null | undefined,
  lang: 'mn' | 'en' = 'mn',
): string {
  if (!cat) return '';
  const def = PROJECT_CATEGORIES[cat];
  return lang === 'en' ? def.name_en : def.name_mn;
}
