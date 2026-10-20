/**
 * Per-project complexity tier helpers.
 *
 * Each project is tagged with one of four tiers and that tier maps to a
 * percentage weight used for employee performance scoring.  Mirrors
 * `COMPLEXITY_PERCENT` in `backend/src/types.ts`.
 */

import type { ProjectComplexity } from '@/shared/types';

export const COMPLEXITY_ORDER: ProjectComplexity[] = ['low', 'mid', 'high', 'special'];

export const COMPLEXITY_PERCENT: Record<ProjectComplexity, number> = {
  low: 25,
  mid: 50,
  high: 75,
  special: 100,
};

export const COMPLEXITY_LABELS_MN: Record<ProjectComplexity, string> = {
  low: 'Бага төвөгшилтэй',
  mid: 'Дунд зэргийн төвөгшилтэй',
  high: 'Өндөр төвөгшилтэй',
  special: 'Онцгой төвөгшилтэй',
};

/** Short label suitable for compact badges. */
export const COMPLEXITY_SHORT_MN: Record<ProjectComplexity, string> = {
  low: 'Бага',
  mid: 'Дунд',
  high: 'Өндөр',
  special: 'Онцгой',
};

/**
 * Tailwind colour classes for a complexity badge.  Built on the semantic
 * status tokens (`--success`/`--info`/`--warning`/`--danger`) so badges sit
 * next to status pills naturally and adapt to light/dark without per-shade
 * `dark:` overrides. Difficulty ramp: low→success, mid→info, high→warning,
 * special→danger.
 */
export function complexityBadgeColor(c: ProjectComplexity | string | null | undefined): string {
  switch (c) {
    case 'low':
      return 'bg-success/10 text-success border-success/30';
    case 'mid':
      return 'bg-info/10 text-info border-info/30';
    case 'high':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'special':
      return 'bg-danger/10 text-danger border-danger/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

/** Safe accessor — falls back to 'mid' for legacy rows missing the field. */
export function normalizeComplexity(c: unknown): ProjectComplexity {
  return c === 'low' || c === 'mid' || c === 'high' || c === 'special' ? c : 'mid';
}

/* ------------------------------------------------------------------ *
 * Per-project FREE complexity weight (0-100). From migration 0093 the
 * fixed 4-tier scale is replaced by a number an admin types in. These
 * helpers drive the numeric input + the badge colour band.
 * ------------------------------------------------------------------ */

/** Weight used when a project has no explicit value (legacy 'mid'). */
export const DEFAULT_COMPLEXITY_PCT = 50;

/** Quick-set chips offered next to the numeric input. */
export const COMPLEXITY_PCT_PRESETS = [10, 25, 50, 75, 100] as const;

/**
 * Төвөгшлийн шатлалын тайлбар — төсөл үүсгэх/засах цонхонд «аль утгыг
 * сонгох вэ» гэдгийг хэрэглэгчид уншуулах жагсаалт (эзний 2026-09-28-ны
 * тэмдэглэл).  Утга бүр `COMPLEXITY_PCT_PRESETS`-д байх ёстой; нэрс i18n-д
 * `complexityGuide.<key>`.
 */
export const COMPLEXITY_TIER_GUIDE = [
  { pct: 100, key: 'special' },
  { pct: 75, key: 'high' },
  { pct: 50, key: 'mid' },
  { pct: 25, key: 'low' },
  { pct: 10, key: 'sketch' },
] as const;

/** Эскиз зураг (EZ) төслийн өгөгдмөл төвөгшил (эзний шийдвэр 2026-09-25). */
export const EZ_COMPLEXITY_PCT = 10;

/**
 * Шинэ төсөл үүсгэхэд ангиллаас хамаарах өгөгдмөл төвөгшил: EZ → 10%,
 * бусад → `DEFAULT_COMPLEXITY_PCT`.  Зөвхөн маягтын анхны утга — admin
 * дараа нь дурын утга оруулж болно.
 */
export function defaultComplexityPctFor(category: string | null | undefined): number {
  return category === 'EZ' ? EZ_COMPLEXITY_PCT : DEFAULT_COMPLEXITY_PCT;
}

/** Coerce arbitrary input to a whole percent in [0, 100]. */
export function clampComplexityPct(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_COMPLEXITY_PCT;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Badge colour band derived from a free percent — keeps visual
 * continuity with the old tier colours (low→emerald … special→rose).
 */
export function complexityPctColor(pct: number | null | undefined): string {
  const n = clampComplexityPct(pct ?? DEFAULT_COMPLEXITY_PCT);
  if (n <= 25) return 'bg-success/10 text-success border-success/30';
  if (n <= 50) return 'bg-info/10 text-info border-info/30';
  if (n <= 75) return 'bg-warning/10 text-warning border-warning/30';
  return 'bg-danger/10 text-danger border-danger/30';
}

/** Pretty-print a complexity tier as "Бага · 25%". */
export function formatComplexity(c: ProjectComplexity | string | null | undefined): string {
  const n = normalizeComplexity(c);
  return `${COMPLEXITY_SHORT_MN[n]} · ${COMPLEXITY_PERCENT[n]}%`;
}
