/* Weight arithmetic + the traffic-light status used by the meters.
 *
 * Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 * module was split up. Data only — no behavioural change. */

import type { Comp, Task } from './types';

export const num = (v: number | string) => parseFloat(String(v)) || 0;
export const sumW = (items: { weight_percent: number | string }[]) =>
  items.reduce((s, i) => s + num(i.weight_percent), 0);

/** Sum of every task's weight under a single drawing. After dropping subtasks,
 *  tasks ARE leaves and they must sum to the drawing's `weight_percent`. */
export function drawingTaskSum(drawingId: number, components: Comp[], tasks: Task[]): number {
  return components
    .filter((c) => c.drawing_id === drawingId)
    .reduce(
      (s, c) =>
        s +
        tasks.filter((t) => t.component_id === c.id).reduce((a, t) => a + num(t.weight_percent), 0),
      0,
    );
}

/** Number of tasks under a drawing (for empty-state checks on the meter). */
export function drawingTaskCount(drawingId: number, components: Comp[], tasks: Task[]): number {
  let n = 0;
  for (const c of components.filter((x) => x.drawing_id === drawingId)) {
    n += tasks.filter((t) => t.component_id === c.id).length;
  }
  return n;
}

/** Sum of task weights under a single component. Used when a component
 *  carries its own weight target (the optional intermediate tier). */
export function componentTaskSum(componentId: number, tasks: Task[]): number {
  return tasks
    .filter((t) => t.component_id === componentId)
    .reduce((s, t) => s + num(t.weight_percent), 0);
}

/** True when the drawing's components are being used as a weighted tier
 *  (any sibling has a non-zero `weight_percent`). When false, components are
 *  pure groupings and the old "tasks-sum-to-drawing-weight" rule applies. */
export function drawingUsesComponentWeights(drawingId: number, components: Comp[]): boolean {
  return components
    .filter((c) => c.drawing_id === drawingId)
    .some((c) => num(c.weight_percent) > 0);
}

/** Split 100% across `count` siblings, giving the remainder to the last one
 *  so the group still sums to exactly 100 after rounding. */
export const splitEvenly = (count: number) => {
  const share = parseFloat((100 / count).toFixed(2));
  const last = parseFloat((100 - share * (count - 1)).toFixed(2));
  return { share, last };
};

export const WEIGHT_EPSILON = 0.5;
export function weightStatus(sum: number, itemCount: number) {
  if (itemCount === 0) return 'empty' as const;
  if (Math.abs(sum - 100) <= WEIGHT_EPSILON) return 'ok' as const;
  if (sum > 100 + WEIGHT_EPSILON) return 'over' as const;
  return 'under' as const;
}

/** Same traffic-light as `weightStatus` but compared against an arbitrary
 *  target instead of 100. Used by drawings since their tasks must sum to the
 *  drawing's posted `weight_percent` rather than 100. */
export function weightStatusVsTarget(sum: number, target: number, itemCount: number) {
  if (itemCount === 0) return 'empty' as const;
  if (target <= 0) return sum < WEIGHT_EPSILON ? 'empty' : ('over' as const);
  if (Math.abs(sum - target) <= WEIGHT_EPSILON) return 'ok' as const;
  if (sum > target + WEIGHT_EPSILON) return 'over' as const;
  return 'under' as const;
}
