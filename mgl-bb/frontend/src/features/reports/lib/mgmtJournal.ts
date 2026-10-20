/** Менежментийн тайлангийн жижиг туслах: хайлтын тодруулга, аватарын үсэг. */

const fold = (s: string) => s.toLocaleLowerCase('mn-MN');

/** Хайлтын үгийг тодруулах хэсгүүд (жижиг/том үсэг ялгахгүй). */
export function highlightParts(text: string, q: string): { text: string; hit: boolean }[] {
  const needle = fold(q.trim());
  if (!needle) return [{ text, hit: false }];
  const hay = fold(text);
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, i)) {
    if (at > i) parts.push({ text: text.slice(i, at), hit: false });
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    i = at + needle.length;
  }
  if (i < text.length) parts.push({ text: text.slice(i), hit: false });
  return parts;
}

/** Аватарын үсэг: «Овог Нэр» → овог + нэрийн эхний үсэг («Отгонбаяр Батболд» → «ОБ»). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = (s: string | undefined) => (s ? (Array.from(s)[0] ?? '') : '');
  const out = parts.length >= 2 ? first(parts[0]) + first(parts[1]) : first(parts[0]);
  return out.toLocaleUpperCase('mn-MN') || '?';
}
