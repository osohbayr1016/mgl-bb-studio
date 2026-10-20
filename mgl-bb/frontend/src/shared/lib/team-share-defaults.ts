/* ──────────────────────────────────────────────────────────────────────
 * Default per-team allocation used to seed `project_team_shares` and
 * power the "Преcет" button on the project-setup team-tab strip.
 *
 * These percentages were the historical "% of project per discipline"
 * weights (BA 30 / BB 32 / HAS 11 / TSBU 8 / TSAH 10 / HD 5 / AU 4 —
 * sum 100). In the post-template model every project is "ажилийн
 * зураг" and these numbers are exactly the team_share defaults — one
 * source of truth for both the create-project dialog (when admins
 * later wire up auto-seeding) and the in-setup preset shortcut.
 * ────────────────────────────────────────────────────────────────── */
export interface PresetTeamShare {
  code: string;
  share: number;
}

export const PRESET_TEAM_SHARES: PresetTeamShare[] = [
  { code: 'BA', share: 30 },
  { code: 'BB', share: 32 },
  { code: 'HAS', share: 11 },
  { code: 'TSBU', share: 8 },
  { code: 'TSAH', share: 10 },
  { code: 'HD', share: 5 },
  { code: 'AU', share: 4 },
];

/** Lookup table form for O(1) reads when a single code's default is needed. */
export const PRESET_TEAM_SHARES_BY_CODE: Record<string, number> = Object.fromEntries(
  PRESET_TEAM_SHARES.map((p) => [p.code, p.share]),
);
