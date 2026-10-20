import type { AssessmentLevelBand } from '../types';
import { DEFAULT_LEVELS, levelForPct } from './score';

export function sortedLevelBands(levels: AssessmentLevelBand[]): AssessmentLevelBand[] {
  return [...(levels.length ? levels : DEFAULT_LEVELS)].sort((a, b) => a.minPct - b.minPct);
}

export function levelSlotCount(levels: AssessmentLevelBand[]): number {
  return sortedLevelBands(levels).length;
}

/** Тэнцүү slot-ийн төв (Intern=0.5, … Expert=4.5). */
export function pctToLevelSlot(
  levels: AssessmentLevelBand[],
  pct: number | null | undefined,
): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sorted = sortedLevelBands(levels);
  const band = levelForPct(levels, pct);
  if (!band) return null;
  const index = sorted.findIndex((b) => b.code === band.code);
  if (index < 0) return null;
  return index + 0.5;
}

/** Radar radial (0..100) — slot бүр ижил завсар. */
export function pctToLevelSlotPct(
  levels: AssessmentLevelBand[],
  pct: number | null | undefined,
): number | null {
  const slot = pctToLevelSlot(levels, pct);
  if (slot == null) return null;
  const n = levelSlotCount(levels);
  return (slot / n) * 100;
}

export function levelAxisTicks(
  levels: AssessmentLevelBand[],
): { value: number; label: string; code: string }[] {
  return sortedLevelBands(levels).map((band, i) => ({
    value: i + 0.5,
    label: band.label,
    code: band.code,
  }));
}

export function levelAxisTicksPct(
  levels: AssessmentLevelBand[],
): { value: number; label: string; code: string }[] {
  const n = levelSlotCount(levels);
  return sortedLevelBands(levels).map((band, i) => ({
    value: ((i + 0.5) / n) * 100,
    label: band.label,
    code: band.code,
  }));
}

export function levelSlotDomain(levels: AssessmentLevelBand[]): [number, number] {
  const n = levelSlotCount(levels);
  return [0, n];
}

/** Level нэрийг багтаах Y тэнхлэгийн өргөн (px). */
export function levelYAxisWidth(levels: AssessmentLevelBand[]): number {
  const longest = levels.reduce((max, b) => Math.max(max, b.label.length), 0);
  return Math.max(48, longest * 6.5 + 12);
}

export function overlapStepPct(levels: AssessmentLevelBand[]): number {
  const n = levelSlotCount(levels);
  return LEVEL_OVERLAP_SLOT * (100 / n);
}

export type ChartSideKey = 'benchmark' | 'self' | 'senior' | 'average';

const SIDE_RANK: Record<ChartSideKey, number> = {
  benchmark: 0,
  self: 1,
  senior: 2,
  average: 3,
};

/** Нэг slot доторх тусгаарлалт (slot домэйнд). */
export const LEVEL_OVERLAP_SLOT = 0.08;

function yKey(y: number): number {
  return Math.round(y * 1000);
}

export function spreadOverlappingY<T extends { x: number; y: number; side: ChartSideKey }>(
  points: T[],
  step = LEVEL_OVERLAP_SLOT,
  yMax?: number,
): T[] {
  const max = yMax ?? 100;
  const byX = new Map<number, T[]>();
  for (const p of points) {
    const bucket = byX.get(p.x) ?? [];
    bucket.push(p);
    byX.set(p.x, bucket);
  }

  const out: T[] = [];
  for (const group of byX.values()) {
    const byY = new Map<number, T[]>();
    for (const p of group) {
      const key = yKey(p.y);
      const bucket = byY.get(key) ?? [];
      bucket.push(p);
      byY.set(key, bucket);
    }
    for (const sameY of byY.values()) {
      if (sameY.length === 1) {
        out.push(sameY[0]!);
        continue;
      }
      const sorted = [...sameY].sort((a, b) => SIDE_RANK[a.side] - SIDE_RANK[b.side]);
      const span = step * (sorted.length - 1);
      const start = -span / 2;
      sorted.forEach((p, i) => {
        out.push({
          ...p,
          y: Math.min(max, Math.max(0, p.y + start + i * step)),
        });
      });
    }
  }
  return out;
}

export function spreadLevelValuesAtAxis(
  values: Partial<Record<ChartSideKey, number | null>>,
  step = LEVEL_OVERLAP_SLOT,
  yMax = 100,
): Partial<Record<ChartSideKey, number | null>> {
  const entries = (Object.entries(values) as [ChartSideKey, number][]).filter(
    ([, v]) => v != null && Number.isFinite(v),
  );
  if (entries.length <= 1) return values;

  const out: Partial<Record<ChartSideKey, number | null>> = { ...values };
  const byY = new Map<number, ChartSideKey[]>();
  for (const [side, v] of entries) {
    const key = yKey(v);
    const bucket = byY.get(key) ?? [];
    bucket.push(side);
    byY.set(key, bucket);
  }

  for (const sides of byY.values()) {
    if (sides.length <= 1) continue;
    sides.sort((a, b) => SIDE_RANK[a] - SIDE_RANK[b]);
    const base = values[sides[0]!]!;
    if (base == null) continue;
    const span = step * (sides.length - 1);
    const start = -span / 2;
    sides.forEach((side, i) => {
      out[side] = Math.min(yMax, Math.max(0, base + start + i * step));
    });
  }
  return out;
}
