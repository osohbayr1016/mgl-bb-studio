/**
 * Deterministic colour-from-name helpers for initials avatars.
 *
 * Lifted verbatim from AssigneeAvatarStack so the mail inbox (sender
 * avatars) and the assignee stack share one implementation — the same
 * person/sender keeps the same hue everywhere, so eyes can scan for a
 * familiar avatar without re-reading names.
 */

/** Two-letter initials from a display name ("Бат Болд" → "ББ"). */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable hue [0,360) hashed from a string, so a name always maps to
 *  the same colour across renders and pages. */
export function stringHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/** Inline style for an initials avatar background — matches the hue/sat/lum
 *  used by AssigneeAvatarStack's Avatar (hsl(hue, 55%, 45%), white text). */
export function avatarStyle(name: string): { backgroundColor: string } {
  return { backgroundColor: `hsl(${stringHue(name)}, 55%, 45%)` };
}
