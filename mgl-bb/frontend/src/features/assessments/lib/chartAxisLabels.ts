/** «CONCEPT_DESIGN» → «Concept Design». */
export function humanizeChartCode(raw: string): string {
  const text = raw.replace(/[_-]+/g, ' ').trim();
  if (!text) return '';
  if (/[a-zа-яёөү]/.test(text)) return text;
  return text
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`);
}

/** Үг бүр тусдаа мөр — доош stack, бүтэн уншигдана. */
export function stackWordsLabel(text: string, maxWords = 12): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .map((word) => (word.length > 22 ? `${word.slice(0, 21)}…` : word));
}

export function sectionChartLabels(
  sections: { code: string; title: string }[],
): string[][] {
  return sections.map((s) => stackWordsLabel(s.title || humanizeChartCode(s.code)));
}

export function xAxisHeightForLabels(labels: string[][]): number {
  const lines = Math.max(1, ...labels.map((l) => l.length));
  return 16 + lines * 12;
}

export function xAxisFontSize(sectionCount: number, maxLines: number): number {
  if (sectionCount >= 7 || maxLines >= 4) return 9;
  if (sectionCount >= 5 || maxLines >= 3) return 9;
  return 10;
}
