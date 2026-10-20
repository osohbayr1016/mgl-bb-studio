import * as React from 'react';

export type SortDir = 'asc' | 'desc';
export type SortState = { id: string; dir: SortDir };

export type DataTableColumn<Row> = {
  id: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  /**
   * Өгвөл багана эрэмбэлэгдэнэ. `cell`-ээс тусдаа байгаа нь санаатай:
   * нүд нь Badge/icon буцаадаг ч эрэмбэ нь доод талын түүхий утгаар
   * явах ёстой.
   */
  sortValue?: (row: Row) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  /** Тоон багана — баруун зэрэгцүүлэлт + `tabular-nums`. */
  numeric?: boolean;
  /** Мобайл карт дээр энэ баганыг харуулахгүй. */
  hideOnMobile?: boolean;
  /** Багана бүрэн нуух (эрх/тохиргооноос хамаарсан). */
  hidden?: boolean;
  /** Багананы өргөн — Tailwind класс (`w-24`) эсвэл `min-w-[8rem]`. */
  width?: string;
  className?: string;
  headClassName?: string;
  /** Мобайл картан дээрх шошго. Өгөхгүй бол `header` хэрэглэнэ. */
  mobileLabel?: React.ReactNode;
};

/**
 * `Intl.Collator` нь `numeric: true`-тэй үед «Блок 2» < «Блок 10» гэж зөв
 * эрэмбэлнэ — энэ апп дүүрэн дугаартай нэртэй (блок, зураг, давхар) тул
 * энгийн `<` харьцуулалт хэрэглэвэл «Блок 10» нь «Блок 2»-оос өмнө гарна.
 * `sensitivity: 'base'` нь том/жижиг үсэг, аялгууг үл ялгана.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a: unknown, b: unknown): number {
  // Хоосон утга ҮРГЭЛЖ хамгийн ард — өгсөх ч, буурах ч үед. Эс тэгвэл
  // буурахаар эрэмбэлэхэд хоосон мөрүүд дээд талд овоорно.
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Хүснэгтийн эрэмбийн төлөв + эрэмбэлэгдсэн мөрүүд.
 *
 * Аппад өмнө нь 8 тусдаа эрэмбийн хэрэгжүүлэлт байсан (LeaderboardPage-ийн
 * `SortableHead`, MyTasksPage-ийн `toggleSort`, ProjectsPage-ийн DropdownMenu,
 * ProjectDetailPage-ийн `Record<string, SortSpec>`, …) — тус бүр өөр
 * төрөлтэй, өөр зан төлөвтэй. Энэ нь тэдгээрийг орлоно.
 *
 * `DataTable` үүнийг дотооддоо дууддаг тул ихэнх дуудагчид шууд хэрэглэх
 * шаардлагагүй — зөвхөн эрэмбийн төлөвийг URL/localStorage-д хадгалах
 * зэрэг тохиолдолд гаднаас удирдана.
 */
export function useTableSort<Row>(
  rows: Row[] | undefined,
  columns: DataTableColumn<Row>[],
  options?: {
    defaultSort?: SortState | null;
    /** Гаднаас удирдах бол — өгвөл дотоод төлөв хэрэглэгдэхгүй. */
    value?: SortState | null;
    onChange?: (next: SortState | null) => void;
  },
) {
  // `options` нь дуудагч тал дээр объект литерал байдаг тул render бүрд
  // шинэ лавлагаа болно. Талбаруудыг нь салгаж авбал доорх useCallback
  // тогтвортой болно (эс тэгвэл eslint-disable бичихээс өөр аргагүй, тэр
  // нь жинхэнэ dependency алдааг хожим нуух эрсдэлтэй).
  const { defaultSort = null, value, onChange } = options ?? {};

  const [internal, setInternal] = React.useState<SortState | null>(defaultSort);
  const controlled = value !== undefined;
  const sort = controlled ? (value ?? null) : internal;

  const setSort = React.useCallback(
    (next: SortState | null) => {
      if (!controlled) setInternal(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  /** asc → desc → эрэмбэгүй гурван үе шаттай. */
  const toggle = React.useCallback(
    (id: string) => {
      if (!sort || sort.id !== id) setSort({ id, dir: 'asc' });
      else if (sort.dir === 'asc') setSort({ id, dir: 'desc' });
      else setSort(null);
    },
    [sort, setSort],
  );

  const sorted = React.useMemo(() => {
    if (!rows) return rows;
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    // Хоосон утга ард үлдэх ёстой тул `compare`-ийн үр дүнг бүхэлд нь
    // эргүүлэхгүй — зөвхөн хоосон биш хосуудад чиглэл нөлөөлнө.
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const aEmpty = av === null || av === undefined || av === '';
      const bEmpty = bv === null || bv === undefined || bv === '';
      if (aEmpty || bEmpty) return compare(av, bv);
      return compare(av, bv) * dir;
    });
  }, [rows, sort, columns]);

  return { sort, setSort, toggle, sorted };
}
