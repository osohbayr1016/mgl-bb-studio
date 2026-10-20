/** Жижиг текстийн туслахууд — кодын харьцуулалт (fold), тооны формат. */

/** Кирилл/латин, зай, зураас, том жижиг үсгийг үл ялгах түлхүүр — «БД 21-101-12» ≡ «BD21-101-12». */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[\s_]+/g, '')
    .replace(/бнбд/g, 'bnbd')
    .replace(/убб/g, 'ubb')
    .replace(/бд/g, 'bd')
    .replace(/снип/g, 'snip')
    .replace(/[^a-z0-9\-*.]/g, '');
}

export function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const r = Math.round(v * 1000) / 1000;
  return String(r);
}
