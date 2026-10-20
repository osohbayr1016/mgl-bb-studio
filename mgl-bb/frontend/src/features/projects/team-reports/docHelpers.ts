/* =============================================================
 * Тайлбар бичгийн (discipline document) нийтлэг туслахууд.
 * -------------------------------------------------------------
 * Бүх 7 баг (BA, BB, HAS, TSBU/CBU, TSAH, HD, AU)-ийн Document
 * компонентууд ижил `v()` / `withSuffix()` хослолыг давхардуулан
 * тодорхойлдог байсныг энд нэгтгэв. Хамгийн чухал нэмэлт нь
 * `mode`-мэдрэгч ба `show()` гэйт:
 *
 *   • mode='internal' — дотоод/хэвлэх горим. Хоосон утга `_____`
 *     болж харагдан, senior-т юу бөглөхийг сануулна (хуучин зан).
 *   • mode='client'   — клиентэд явах PDF. Хоосон утга огт
 *     харагдахгүй: `v()`/`withSuffix()` хоосон мөр буцааж, элементийг
 *     `show()`-оор бүрэн нууна. Ингэснээр "дуусаагүй маягт" мэт
 *     `_____` болон өлгөөтэй шошго гарахгүй.
 * ============================================================= */

export const BLANK = '_____';

export type DocMode = 'internal' | 'client';

/** Утга утга учиртай дүүрсэн эсэх (хоосон мөр / тэг бус тоо / true). */
export function hasValue(x: unknown): boolean {
  if (typeof x === 'string') return x.trim().length > 0;
  if (typeof x === 'number') return Number.isFinite(x);
  return !!x;
}

export interface DocHelpers {
  mode: DocMode;
  /** Утгыг текст болгоно. Хоосон бол client-д '', internal-д `_____`. */
  v: (s: unknown, fallback?: string) => string;
  /** Утга + нэгж. Хоосон бол client-д '' (нэгжгүй), internal-д `_____ нэгж`. */
  withSuffix: (val: unknown, suffix: string) => string;
  /** Дор хаяж нэг утга дүүрсэн эсэх. */
  has: (...vals: unknown[]) => boolean;
  /** Элемент харуулах эсэх: internal-д үргэлж (сануулга), client-д зөвхөн
   *  утга дүүрсэн үед. JSX-д `{show(answers.x) && <li>…</li>}` хэлбэрээр. */
  show: (...vals: unknown[]) => boolean;
}

export function makeDocHelpers(mode: DocMode): DocHelpers {
  const blank = mode === 'client' ? '' : BLANK;

  const v = (s: unknown, fallback: string = blank): string => {
    if (typeof s === 'string' && s.trim().length > 0) return s.trim();
    if (typeof s === 'number' && Number.isFinite(s)) return String(s);
    return fallback;
  };

  const withSuffix = (val: unknown, suffix: string): string => {
    const s = v(val, '');
    if (s) return `${s} ${suffix}`;
    return mode === 'client' ? '' : `${BLANK} ${suffix}`;
  };

  const has = (...vals: unknown[]): boolean => vals.some(hasValue);

  const show = (...vals: unknown[]): boolean => mode === 'internal' || vals.some(hasValue);

  return { mode, v, withSuffix, has, show };
}
