/** One-click roster fills: add the project category's teams, and apply the
 *  historical preset share table (BA 30 / BB 32 / HAS 11 / …).
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import type { ProjectTeamShare } from '@/shared/types';
import { PRESET_TEAM_SHARES_BY_CODE } from '@/shared/lib/team-share-defaults';
import { PROJECT_CATEGORIES } from '@/shared/lib/project-categories';
import type { SetupStore } from './useSetupStore';

export function useTeamSharePresets(store: SetupStore) {
  const {
    id,
    projectCategory,
    allTeams,
    teamShares,
    setTeamShares,
    setTeamSharesDirty,
  } = store;

  // Add any team in the project's category that isn't already in the
  // roster, seeded at the category's preset share. Existing teams stay
  // put — both their membership and share_percent are untouched, so the
  // admin can safely click this on a project they've already started
  // tuning. Local-only; "Хадгалах" commits via saveTeamShares.
  const applyCategoryTeams = (): { added: number; missing: string[] } => {
    if (!projectCategory) return { added: 0, missing: [] };
    const def = PROJECT_CATEGORIES[projectCategory];
    const have = new Set(teamShares.map((ts) => ts.team_id));
    const additions: ProjectTeamShare[] = [];
    const missing: string[] = [];
    def.teamCodes.forEach((code, i) => {
      const team = allTeams.find((t) => t.code === code);
      if (!team) {
        missing.push(code);
        return;
      }
      if (have.has(team.id)) return;
      additions.push({
        id: 0,
        project_id: Number(id ?? 0),
        team_id: team.id,
        share_percent: def.shares[code] ?? 0,
        sort_order: teamShares.length + i,
        team_code: team.code,
        team_name_mn: team.name_mn,
        team_name_en: team.name_en,
      } as ProjectTeamShare);
    });
    if (additions.length > 0) {
      setTeamShares((prev) => [...prev, ...additions]);
      setTeamSharesDirty(true);
    }
    return { added: additions.length, missing };
  };

  // Rewrite every team-share whose code matches a preset entry to that
  // preset value. Teams not in the preset table are left alone — the
  // admin sets those manually. The call is fully local; "Хадгалах"
  // commits via the existing saveTeamShares path.
  const applyPresetTeamShares = (): { changed: number; skipped: number } => {
    let changed = 0;
    let skipped = 0;
    setTeamShares((prev) =>
      prev.map((ts) => {
        const code = ts.team_code;
        if (!code) {
          skipped += 1;
          return ts;
        }
        const preset = PRESET_TEAM_SHARES_BY_CODE[code];
        if (preset == null) {
          skipped += 1;
          return ts;
        }
        if (Math.abs(Number(ts.share_percent || 0) - preset) < 0.001) return ts;
        changed += 1;
        return { ...ts, share_percent: preset };
      }),
    );
    if (changed > 0) setTeamSharesDirty(true);
    return { changed, skipped };
  };

  return {
    applyCategoryTeams,
    applyPresetTeamShares,
  };
}
