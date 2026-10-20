/** Small formatting/parsing helpers shared across the ProjectDetailPage tree.
 *  Block-level aggregations live in `./blockHelpers`.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { formatDate } from '@/shared/lib/time';
import { formatDisplayName, formatTimeAgo } from '@/shared/lib/formatting';

import { TEAM_PREFIX_CODES } from './constants';

/** Formats a full name stored as "LastName FirstName [...]" into "FirstName L."
 *  so it fits in narrow table cells without truncating. */
export function fmtAssigneeName(full_name: string): string {
  const display = formatDisplayName(full_name);
  const parts = display.trim().split(/\s+/);
  if (parts.length < 2) return display;
  const first = parts.slice(0, -1).join(' ');
  const last = parts[parts.length - 1];
  return `${first} ${last[0]?.toUpperCase() ?? ''}.`;
}

/** Parse the leading discipline code from a drawing name. Mirrors the
 *  backend so both agree on which team "owns" a drawing for self-claim. */
export function drawingTeamCode(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  // Longest-prefix-first so e.g. "TSBU" beats "TS"; we already sort the
  // tuple by length descending below to be safe across future additions.
  const sortedCodes = [...TEAM_PREFIX_CODES].sort((a, b) => b.length - a.length);
  for (const code of sortedCodes) {
    if (
      upper.startsWith(`${code} `) ||
      upper.startsWith(`${code}-`) ||
      upper.startsWith(`${code}_`) ||
      upper === code
    )
      return code;
  }
  // Fall back to keyword matching on the drawing's Mongolian description so
  // legacy projects without prefix codes still bucket correctly.
  const lower = trimmed.toLowerCase();
  if (lower.includes('архитектур')) return 'BA';
  if (lower.includes('бүтээц')) return 'BB';
  if (lower.includes('халаалт') || lower.includes('агаар сэлгэлт')) return 'HAS';
  if (lower.includes('цэвэр') || lower.includes('бохир')) return 'TSBU';
  if (lower.includes('цахилгаан')) return 'TSAH';
  if (lower.includes('холбоо') || lower.includes('дохиолол')) return 'HD';
  if (lower.includes('автомат')) return 'AU';
  if (lower.includes('эскиз')) return 'EZ';
  if (lower.includes('интерьер')) return 'IZ';
  if (lower.includes('тохижилт')) return 'GT';
  return null;
}

export function progressColor(value: number) {
  if (value >= 100) return 'bg-green-500';
  if (value >= 70) return 'bg-primary';
  if (value >= 30) return 'bg-yellow-500';
  if (value > 0) return 'bg-orange-500';
  return 'bg-muted-foreground/40';
}

// Идэвхийн фийдийн "X минутын өмнө" — нэг эх үүсвэр болгож shared
// formatTimeAgo руу шилжүүлэв (өмнө нь энд бараг ижил хувилбар хуулагдсан байв).
export function timeAgo(iso: string | null): string {
  return formatTimeAgo(iso, 'mn');
}

export function fmtDate(d: Date | null) {
  if (!d) return '—';
  return formatDate(d);
}
