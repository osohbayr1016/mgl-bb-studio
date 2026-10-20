/**
 * Leaderboard scoring helpers.
 *
 * After the pricing/quote feature was removed, performance is recorded
 * purely as percentage points (sums of `user_points.amount`).  Each
 * project carries a free per-project complexity weight (`complexity_pct`,
 * 0-100, set by an admin), and a progress submission awards
 *
 *     share = complexityPct × Δpct / 100   →   per-user = share / N
 *
 * No money involved anywhere on the client.
 *
 * Privacy reminder:
 *   - Admin tier (admin) sees full ranked list.
 *   - Worker tier (engineer / architect / senior) sees ONLY their own data.
 *   - Client role has no access at all.
 */

import { useAuth } from '@/shared/context/AuthContext';

/** Бүтээмжийн хувь — яг 3 орон («0.312%»). 1 орон 0.312-ыг «0.3%» болгож харуулдаг байсан. */
export function formatPoints(points: number | null | undefined): string {
  const v = typeof points === 'number' && Number.isFinite(points) ? points : 0;
  const rounded = Math.round(v * 1000) / 1000;
  return `${rounded.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`;
}

/** Compact "+1.2%" used by the post-submit toast. */
export function formatAwardLine(points: number): string {
  return `+${formatPoints(points)}`;
}

const ADMIN_TIER_ROLES = new Set<string>(['admin']);

/**
 * Convenience hook: are we logged in as someone allowed to see other
 * people's leaderboard data?
 */
export function useIsAdminTier(): boolean {
  const { user } = useAuth();
  return !!user && ADMIN_TIER_ROLES.has(user.role);
}

/** Same as {@link useIsAdminTier} but plain function for non-React code. */
export function isAdminTier(role: string | null | undefined): boolean {
  return !!role && ADMIN_TIER_ROLES.has(role);
}

/**
 * "Менежер эсвэл дээш" — admin буюу баг ахлах senior.
 *
 * Backend-ийн `requireManager` (admin + senior) болон Layout-ийн
 * `/app/approvals` цэсний шалгууртай ижил.  Даалгавар үүсгэх зэрэг
 * бүтцийн үйлдлүүдэд ашиглана — leaderboard-ын нууцлалын шалгуур
 * ({@link isAdminTier}) -тай хольж болохгүй.
 */
const MANAGER_TIER_ROLES = new Set<string>(['admin', 'senior']);

export function isManagerTier(role: string | null | undefined): boolean {
  return !!role && MANAGER_TIER_ROLES.has(role);
}

export function useIsManagerTier(): boolean {
  const { user } = useAuth();
  return isManagerTier(user?.role);
}
