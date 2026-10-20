/* Team code parsing, display names and the drawing tab-strip palette.
 *
 * Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 * module was split up. Data only — no behavioural change. */

/** Parse the leading team code (BA, BB, HAS, TSBU, TSAH, HD, AU, IZ) from
 *  the drawing name so we can filter the assignee picker to the right team.
 *  `EZ`, `GT`, or manually-named drawings return null → picker shows all. */
export const TEAM_PREFIX_CODES = ['BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU', 'IZ'] as const;
export function drawingTeamCode(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Match either "BA - …", "BA: …", "BA…" at the start, case-insensitive.
  const upper = trimmed.toUpperCase();
  for (const code of TEAM_PREFIX_CODES) {
    if (
      upper.startsWith(`${code} `) ||
      upper.startsWith(`${code}-`) ||
      upper.startsWith(`${code}_`) ||
      upper === code
    )
      return code;
  }
  // Also recognise Cyrillic discipline words.
  const lower = trimmed.toLowerCase();
  if (lower.includes('архитектур')) return 'BA';
  if (lower.includes('бүтээц')) return 'BB';
  if (lower.includes('халаалт') || lower.includes('агаар сэлгэлт')) return 'HAS';
  if (lower.includes('цэвэр') || lower.includes('бохир')) return 'TSBU';
  if (lower.includes('цахилгаан')) return 'TSAH';
  if (lower.includes('холбоо') || lower.includes('дохиолол')) return 'HD';
  if (lower.includes('автомат удирдлага')) return 'AU';
  if (lower.includes('интерьер')) return 'IZ';
  return null;
}

export const TEAM_NAME_BY_CODE: Record<string, string> = {
  BA: 'Барилга архитектур',
  BB: 'Барилга бүтээц',
  HAS: 'Халаалт агаар сэлгэлт',
  TSBU: 'Цэвэр бохир ус',
  TSAH: 'Цахилгаан',
  HD: 'Холбоо дохиолол',
  AU: 'Автомат удирдлага',
  IZ: 'Интерьер зураг',
  EZ: 'Эскиз зураг',
  GT: 'Гадна тохижилт',
};

/** Per-team accent palette for the drawing tab strip.  Each entry pairs a
 *  vivid "active" pill with a softer "inactive" tint so the eye can scan
 *  10 tabs at a glance — admins recognise BA / BB / HAS by colour rather
 *  than reading text.  Falls back to a primary tone when the drawing
 *  isn't recognised as a known discipline. */
export const TEAM_COLORS: Record<string, { active: string; inactive: string }> = {
  BA: {
    active: '!bg-blue-500    !text-white shadow-blue-500/30',
    inactive: 'bg-info/10 text-info hover:bg-info/20',
  },
  BB: {
    active: '!bg-orange-500  !text-white shadow-orange-500/30',
    inactive: 'bg-warning/10 text-warning hover:bg-warning/20',
  },
  HAS: {
    active: '!bg-cyan-500    !text-white shadow-cyan-500/30',
    inactive: 'bg-info/10 text-info hover:bg-info/20',
  },
  TSBU: {
    active: '!bg-teal-500    !text-white shadow-teal-500/30',
    inactive: 'bg-success/10 text-success hover:bg-success/20',
  },
  TSAH: {
    active: '!bg-amber-500   !text-white shadow-amber-500/30',
    inactive: 'bg-warning/10 text-warning hover:bg-warning/20',
  },
  HD: {
    active: '!bg-rose-500    !text-white shadow-rose-500/30',
    inactive: 'bg-danger/10 text-danger hover:bg-danger/20',
  },
  AU: {
    active: '!bg-violet-500  !text-white shadow-violet-500/30',
    inactive: 'bg-violet-500/10  text-violet-700  dark:text-violet-300  hover:bg-violet-500/20',
  },
  EZ: {
    active: '!bg-lime-500    !text-white shadow-lime-500/30',
    inactive: 'bg-success/10 text-success hover:bg-success/20',
  },
  IZ: {
    active: '!bg-fuchsia-500 !text-white shadow-fuchsia-500/30',
    inactive: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-500/20',
  },
  GT: {
    active: '!bg-emerald-500 !text-white shadow-emerald-500/30',
    inactive: 'bg-success/10 text-success hover:bg-success/20',
  },
};
export const FALLBACK_TAB_COLOR = {
  active: '!bg-primary !text-primary-foreground shadow-primary/30',
  inactive: 'bg-muted/40 text-foreground hover:bg-muted/60',
};
