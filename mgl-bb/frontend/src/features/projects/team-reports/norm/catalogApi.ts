/* =============================================================
 * Норм дүрмийн каталогийн API хэлбэр (GET /api/norm-catalog).
 * -------------------------------------------------------------
 * Каталог одоо DB-д (migration 0120) — статик catalog.ts массивыг орлоно.
 * `id` нь DB-ийн тоон id (засах/устгахад), `key` нь тогтвортой слаг/түлхүүр
 * (ангилалд Accordion value, item-д checkbox-ийн хадгалалтын түлхүүр).
 * ============================================================= */

export interface NormCatalogItem {
  /** DB тоон id — PATCH/DELETE-д. */
  id: number;
  /** Хадгалалтын тогтвортой түлхүүр (answers.checked[key]) — өөрчлөгддөггүй. */
  key: string;
  code: string;
  title: string;
}

export interface NormCatalogCategory {
  /** DB тоон id — PATCH/DELETE-д. */
  id: number;
  /** Тогтвортой слаг (Accordion value). */
  key: string;
  title: string;
  items: NormCatalogItem[];
}

export interface NormCatalogResponse {
  catalog: NormCatalogCategory[];
}

/** TanStack query key — каталог ховор өөрчлөгддөг тул staleTime: Infinity. */
export const NORM_CATALOG_KEY = ['/norm-catalog'] as const;
