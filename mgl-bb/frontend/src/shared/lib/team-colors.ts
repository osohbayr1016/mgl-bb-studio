/**
 * Shared per-team accent palette.
 *
 * Every place in the app that surfaces a team — calendar announcements,
 * approval entries, user lists, attendance logs, project task chips —
 * uses these helpers so the same team always reads as the same color.
 * That lets a glance at the dashboard tell you "yellow = TSAH" without
 * having to read the code text on every chip.
 *
 * The palette intentionally mirrors the hues already used in the
 * Project Setup tab strip and the Company Dashboard pie chart so the
 * three surfaces stay visually consistent.
 */

export type TeamChipTone = {
  /** Solid fill used for primary accent dots / dotted markers. */
  hex: string;
  /** Tailwind classes for a translucent chip (bg + text + border). */
  chip: string;
  /** Tailwind classes for a stronger filled chip (used on dark hero
   *  cards where the translucent chip would wash out). */
  chipSolid: string;
  /** Tailwind classes for a left-border accent stripe on cards. */
  border: string;
  /** Tailwind text-only color (used in inline labels). */
  text: string;
};

/* For each hue we keep two text shades so the chip stays readable in
 * both themes: the `*-700` shade for light mode (the chip sits on a
 * light surface) and the original `*-300/-400` shade for dark mode
 * (chip sits on dark surface). The `chipSolid` keeps `text-white`
 * because it always sits on a saturated `*-500/90` background where
 * white reads in either theme. */
const PALETTE: Record<string, TeamChipTone> = {
  BA: {
    hex: '#3b82f6',
    chip: 'bg-blue-500/15    text-blue-700    dark:text-blue-300    border-blue-500/40',
    chipSolid: 'bg-blue-500/90    text-white border-blue-400',
    border: 'border-l-blue-500',
    text: 'text-blue-700 dark:text-blue-400',
  },
  BB: {
    hex: '#f97316',
    chip: 'bg-orange-500/15  text-orange-700  dark:text-orange-300  border-orange-500/40',
    chipSolid: 'bg-orange-500/90  text-white border-orange-400',
    border: 'border-l-orange-500',
    text: 'text-orange-700 dark:text-orange-400',
  },
  HAS: {
    hex: '#06b6d4',
    chip: 'bg-cyan-500/15    text-cyan-700    dark:text-cyan-300    border-cyan-500/40',
    chipSolid: 'bg-cyan-500/90    text-white border-cyan-400',
    border: 'border-l-cyan-500',
    text: 'text-cyan-700 dark:text-cyan-400',
  },
  TSBU: {
    hex: '#14b8a6',
    chip: 'bg-teal-500/15    text-teal-700    dark:text-teal-300    border-teal-500/40',
    chipSolid: 'bg-teal-500/90    text-white border-teal-400',
    border: 'border-l-teal-500',
    text: 'text-teal-700 dark:text-teal-400',
  },
  TSAH: {
    hex: '#f59e0b',
    chip: 'bg-amber-500/15   text-amber-700   dark:text-amber-300   border-amber-500/40',
    chipSolid: 'bg-amber-500/90   text-white border-amber-400',
    border: 'border-l-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
  },
  HD: {
    hex: '#f43f5e',
    chip: 'bg-rose-500/15    text-rose-700    dark:text-rose-300    border-rose-500/40',
    chipSolid: 'bg-rose-500/90    text-white border-rose-400',
    border: 'border-l-rose-500',
    text: 'text-rose-700 dark:text-rose-400',
  },
  AU: {
    hex: '#8b5cf6',
    chip: 'bg-violet-500/15  text-violet-700  dark:text-violet-300  border-violet-500/40',
    chipSolid: 'bg-violet-500/90  text-white border-violet-400',
    border: 'border-l-violet-500',
    text: 'text-violet-700 dark:text-violet-400',
  },
  EZ: {
    hex: '#84cc16',
    chip: 'bg-lime-500/15    text-lime-700    dark:text-lime-300    border-lime-500/40',
    chipSolid: 'bg-lime-500/90    text-white border-lime-400',
    border: 'border-l-lime-500',
    text: 'text-lime-700 dark:text-lime-400',
  },
  IZ: {
    hex: '#ec4899',
    chip: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/40',
    chipSolid: 'bg-fuchsia-500/90 text-white border-fuchsia-400',
    border: 'border-l-fuchsia-500',
    text: 'text-fuchsia-700 dark:text-fuchsia-400',
  },
  GT: {
    hex: '#10b981',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
    chipSolid: 'bg-emerald-500/90 text-white border-emerald-400',
    border: 'border-l-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
  MGMT: {
    hex: '#6366f1',
    chip: 'bg-indigo-500/15  text-indigo-700  dark:text-indigo-300  border-indigo-500/40',
    chipSolid: 'bg-indigo-500/90  text-white border-indigo-400',
    border: 'border-l-indigo-500',
    text: 'text-indigo-700 dark:text-indigo-400',
  },
};

const FALLBACK: TeamChipTone = {
  hex: '#64748b',
  chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/40',
  chipSolid: 'bg-slate-500/90 text-white border-slate-400',
  border: 'border-l-slate-500',
  text: 'text-slate-700 dark:text-slate-400',
};

/** Returns the full tone bundle for a team code.  Pass `null` /
 *  `undefined` when the entity has no team — the caller gets the
 *  neutral slate tone, which still matches the design system but
 *  signals "unscoped". */
export function teamTone(code: string | null | undefined): TeamChipTone {
  if (!code) return FALLBACK;
  return PALETTE[code.toUpperCase()] ?? FALLBACK;
}

/** Convenience: just the chip class string.  Most call sites only
 *  need this; they can keep using `<Badge variant="outline" className={teamChipClass(code)}>`. */
export function teamChipClass(code: string | null | undefined): string {
  return teamTone(code).chip;
}

/** Convenience: just the dot/swatch hex color (e.g. for inline `style`
 *  on a 2×2 indicator dot or recharts series colors). */
export function teamHex(code: string | null | undefined): string {
  return teamTone(code).hex;
}
