import { useSyncExternalStore } from 'react';
import { brand, subscribeBrand, getBrandSnapshot, type Brand } from './brand';

/**
 * React дотор брэндийг унших hook.
 *
 * `brand()` нь sync тул компонент дотор шууд дуудаж БОЛНО — гэхдээ админ
 * тохиргоог соливол дахин зурагдахгүй.  Энэ hook нь `useSyncExternalStore`-оор
 * захиалдаг тул `applyOrgSettings()` дуудагдмагц бүх хэрэглэгч дахин зурагдана.
 *
 * Компонентын гаднах кодод (экспортын утилит, формат хийгч) `brand()`-ыг шууд
 * ашигла.
 */
export function useBrand(): Brand {
  return useSyncExternalStore(subscribeBrand, getBrandSnapshot, getBrandSnapshot);
}

export { brand };
export type { Brand };
