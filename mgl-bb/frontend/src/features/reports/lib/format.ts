/** Тайлангийн тоонуудын форматлагч — нэг газарт, хүснэгт/карт/Excel ижил. */

/**
 * ОНООНЫ нарийвчлал — утгаас хамаарна.  Хэмжсэн (прод 2026-09-16): нэг тайлангийн
 * оноо дунджаар 0.03, жижиг жинтэй таск дээр 0.0002; ажилтны 7 хоногийн
 * нийлбэрийн медиан ~0.1.  1 орны дугуйлалт хүн бүрийг «0%» болгож, өдрийн
 * нэмэгдлийг хэзээ ч харуулахгүй байсан (эзний гомдол).
 *   |v| ≥ 1  → 1 орон («2.2%»). Самбарын `formatPoints` бол 3 орон («2.200%»).
 *   |v| < 1  → 3 орон хүртэл, сүүлийн 0-уудыг хасна («0.06%», «0.001%»)
 * Жинхэнэ 0 л «0%» гэж гарна.
 */
export function fmtPtsNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1)
    return (Math.round(v * 10) / 10).toLocaleString('mn-MN', { maximumFractionDigits: 1 });
  return (Math.round(v * 1000) / 1000).toLocaleString('mn-MN', { maximumFractionDigits: 3 });
}

export function fmtPts(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${fmtPtsNumber(n)}%`;
}

export function fmtHours(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(Math.round(n * 10) / 10).toLocaleString('mn-MN')} ц`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('mn-MN');
}

/**
 * Дельта ЗӨВХӨН абсолют утгаар — «0.1 % → 1.9 %» нь +1800 % гэдэг нь хэнд ч
 * ойлгомжгүй (эзний гомдол 2026-09-15), тиймээс «+1.8 %» гэж хэмжигдэхүүнийхээ
 * нэгжээр л харуулна.  Хувийн харьцаа (pct_change) хаана ч харагдахгүй.
 */
export function fmtDeltaPts(current: number, previous: number | null | undefined): string {
  if (previous == null || !Number.isFinite(previous)) return '';
  return fmtSigned(current - previous, '%');
}

/**
 * Тэмдэгтэй дельта.  `%` нэгж = ОНОО тул `fmtPtsNumber`-ийн адаптив нарийвчлал
 * (эс тэгвэл +0.02 гэсэн долоо хоногийн өсөлт «» болж алга болно); бусад нэгж 1 орон.
 */
export function fmtSigned(v: number | null | undefined, unit = ''): string {
  if (v == null || !Number.isFinite(v)) return '';
  const r = unit === '%' ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10;
  const abs = unit === '%' ? fmtPtsNumber(Math.abs(r)) : Math.abs(r).toLocaleString('mn-MN');
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${abs}${unit}`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}
