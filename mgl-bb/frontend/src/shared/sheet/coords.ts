/**
 * Хүснэгтийн (sheet) КООРДИНАТЫН цөм.
 *
 * Excel маягийн бүх хүснэгт нэг л зүйл дээр тохирдог: `{r,c}` координат ба
 * тэгш өнцөгт сонголт. Энэ файл ЯМАР Ч өгөгдлийн загвараас (үнийн санал,
 * тоо хэмжээ, ирц…) хамааралгүй — зөвхөн тоо. Тиймээс `useSheetNav` /
 * `useSheetClipboard` хоёр эндээс тэжээгддэг ба хүссэн хүснэгтэд дахин
 * ашиглагдана.
 *
 * Гарал үүсэл: features/quotes/components/grid/useGridNav.ts дотор амьдарч
 * байсан `Coord` / `GridSelection` / `selectionRect`-ийг ерөнхий болгож
 * салгав (нэрийг `Sheet*` угтвартай болгов).
 */

/** Нүдний координат. Аль аль нь 0-ээс эхэлсэн индекс. */
export interface Coord {
  r: number;
  c: number;
}

/**
 * Сонголт: `anchor` нь эхэлсэн нүд, `focus` нь одоогийн ирмэг (Shift+сумаар
 * хөдөлдөг). Дараалал баталгаагүй тул хэрэглэхээсээ өмнө `selectionRect`-ээр
 * нормчлоно.
 */
export interface SheetSelection {
  anchor: Coord;
  focus: Coord;
}

/** Нормчилсон тэгш өнцөгт (min ≤ max үргэлж биелнэ). */
export interface SheetRect {
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
}

/** Сонголтыг нормчилсон тэгш өнцөгт болгоно. */
export function selectionRect(sel: SheetSelection): SheetRect {
  return {
    minR: Math.min(sel.anchor.r, sel.focus.r),
    maxR: Math.max(sel.anchor.r, sel.focus.r),
    minC: Math.min(sel.anchor.c, sel.focus.c),
    maxC: Math.max(sel.anchor.c, sel.focus.c),
  };
}

/** Нэг нүдний сонголт. */
export function cellSelection(co: Coord): SheetSelection {
  return { anchor: co, focus: co };
}

/** Ганц нүд сонгогдсон эсэх (clipboard-ын default зан төлөвт чухал). */
export function isSingleCell(sel: SheetSelection): boolean {
  return sel.anchor.r === sel.focus.r && sel.anchor.c === sel.focus.c;
}

export function sameCoord(a: Coord | null | undefined, b: Coord | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.r === b.r && a.c === b.c;
}

/** Координат хүснэгтийн дотор байгаа эсэх. */
export function inBounds(co: Coord, rows: number, cols: number): boolean {
  return co.r >= 0 && co.r < rows && co.c >= 0 && co.c < cols;
}

/** Координатыг хүснэгтийн хил рүү шахна. */
export function clampCoord(co: Coord, rows: number, cols: number): Coord {
  return {
    r: Math.min(Math.max(0, co.r), Math.max(0, rows - 1)),
    c: Math.min(Math.max(0, co.c), Math.max(0, cols - 1)),
  };
}

/** Тэгш өнцөгтийг хүснэгтийн хил рүү шахна. */
export function clampRect(rect: SheetRect, rows: number, cols: number): SheetRect {
  return {
    minR: Math.max(0, rect.minR),
    maxR: Math.min(rows - 1, rect.maxR),
    minC: Math.max(0, rect.minC),
    maxC: Math.min(cols - 1, rect.maxC),
  };
}

export function rectContains(rect: SheetRect, r: number, c: number): boolean {
  return r >= rect.minR && r <= rect.maxR && c >= rect.minC && c <= rect.maxC;
}

/** Сонголт нүдийг хамарч байгаа эсэх (highlight-д). */
export function isInSelection(sel: SheetSelection | null | undefined, r: number, c: number): boolean {
  if (!sel) return false;
  return rectContains(selectionRect(sel), r, c);
}

/** DOM ref registry-д хэрэглэх тогтмол түлхүүр. */
export function cellKey(r: number, c: number): string {
  return `${r}:${c}`;
}
