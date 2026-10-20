/**
 * Helpers to turn a raw From/To/Cc header value ("Бат Болд <bat@x.com>",
 * "a@x.com, b@y.com") into human-friendly display strings for the inbox.
 */

/** Human display name for the first sender in a header value.
 *  "Бат Болд <bat@x.com>" → "Бат Болд"; "bat@x.com" → "bat". */
export function displaySender(raw: string | null | undefined): string {
  if (!raw) return '';
  const first = raw.split(',')[0]?.trim() ?? '';
  const named = first.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (named && named[1] && named[1].trim()) return named[1].trim();
  const addr = (named ? named[2] : first) ?? '';
  const email = addr.replace(/[<>"]/g, '').trim();
  const local = email.split('@')[0] ?? email;
  return local || email;
}

/** The bare email address of the first entry in a header value. */
export function firstEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  const first = raw.split(',')[0]?.trim() ?? '';
  const m = first.match(/<([^>]+)>/);
  return (m ? m[1] : first).replace(/[<>"]/g, '').trim();
}

/** Comma-joined participant display names (deduped, in order) from a raw
 *  GROUP_CONCAT of `from_addr` header values. */
export function participantNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const name = displaySender(part);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}
