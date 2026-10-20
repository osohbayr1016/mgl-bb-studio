/**
 * Excel-хүснэгтийн ГАР НАВИГАЦИ + нүдний СОНГОЛТ (ерөнхий).
 *
 * Загвар: focus-той нүдийг `{r,c}` координатаар хадгалж, засагдах элементүүдийг
 * (`<input>` / `<textarea>`) ref registry-д барина. Нүд бүр өөрийн (r,c)-г
 * мэддэг тул onKeyDown дараагийн координатыг тооцоод тухайн ref рүү focus хийнэ.
 *
 * Enter/Tab үндсэн навигатор; Up/Down мөр солино (number spinner-ийг зориудаар
 * дардаг); Left/Right текст нүдэд caret хилд хүрсэн үед л багана солино. Shift+
 * сум сонголтыг өргөтгөнө. Ctrl/Cmd+D доош дүүргэнэ. Escape blur + commit.
 * Навигаци өгөгдөл засдаггүй тул dirty болгохгүй.
 *
 * Гарал үүсэл: features/quotes/components/grid/useGridNav.ts. ЯЛГАА нь энэ
 * хувилбар `GridColumn`/`GridLineRow` (эсвэл ямар нэг quote төрөл) мэддэггүй —
 * зөвхөн `rows`/`cols` тоо ба `isEditable(r,c)` предикат. Ингэснээр «засагдах
 * нүдний орон зай» гэсэн тусдаа индексжүүлэлт хэрэггүй болж, оронд нь
 * навигаци засагдахгүй нүднүүдийг АЛГАСАН явна.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cellKey,
  cellSelection,
  inBounds,
  isInSelection,
  type Coord,
  type SheetSelection,
} from '@/shared/sheet/coords';

/** Хүснэгтийн нүдэнд focus авах боломжтой элементүүд. */
export type SheetCellElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface UseSheetNavOptions {
  /** Хүснэгтийн мөрийн тоо. */
  rows: number;
  /** Хүснэгтийн баганы тоо. */
  cols: number;
  /** Нүд засагдах эсэх. Өгөөгүй бол бүх нүд засагдана гэж үзнэ. */
  isEditable?: (r: number, c: number) => boolean;
  /** Ctrl/Cmd+D. Ихэвчлэн `useSheetClipboard().fillDown`. */
  onFillDown?: () => void;
  /** Escape / blur — autosave flush. */
  onCommit?: () => void;
  /**
   * Хамгийн доод засагдах мөр дээр Enter дарсан үед (өмнөх хувилбарын
   * «section-ийн сүүлд мөр нэмэх»-ийн ерөнхий хэлбэр). Дуудахаас өмнө
   * `{r: co.r + 1, c: co.c}` руу focus хүлээлгэнд (pendingFocus) тавина —
   * шинэ мөр рендэрлэгдмэгц focus тэнд буух болно. Callback дотроосоо
   * `requestFocus(...)`-ыг дуудвал өөр байрлал руу дарж бичиж болно.
   */
  onEnterPastEnd?: (co: Coord) => void;
}

/** number input-д selectionStart найдваргүй → Left/Right caret хэвээр үлдэнэ. */
function atCaretBoundary(el: SheetCellElement, key: string): boolean {
  // Dropdown нүдэнд caret байхгүй — Left/Right шууд нүд солино.
  if (el instanceof HTMLSelectElement) return true;
  if ((el as HTMLInputElement).type === 'number') return false;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start == null || end == null || start !== end) return false;
  return key === 'ArrowLeft' ? start === 0 : start === (el.value ?? '').length;
}

export function useSheetNav(options: UseSheetNavOptions) {
  const { rows, cols } = options;

  const cellRefs = useRef<Map<string, SheetCellElement>>(new Map());
  const [focused, setFocused] = useState<Coord | null>(null);
  const [selection, setSelectionState] = useState<SheetSelection | null>(null);
  // Callback-ууд тогтвортой байхын тулд төлөв/сонголтыг ref-ээр давхар барина.
  const selectionRef = useRef<SheetSelection | null>(null);
  // Мөр нэмсэний дараа (rows өөрчлөгдсөн) шинэ нүдэнд focus хийх хүлээлт.
  const pendingFocus = useRef<Coord | null>(null);
  // Программаар focus хийх үед элементийн onFocus сонголтыг дахин бичихээс сэргийлнэ.
  const programmatic = useRef(false);

  // Хамгийн сүүлийн callback-уудыг ref-т — ингэснээр доорх callback-ууд өгөгдөл
  // засах бүрт дахин үүсэхгүй (memo-лсон нүднүүд дэмий re-render хийхгүй).
  // Рендэрийн явцад ref бичих нь react-hooks/refs дүрмээр хориотой тул effect-д.
  const isEditableRef = useRef(options.isEditable);
  const onFillDownRef = useRef(options.onFillDown);
  const onCommitRef = useRef(options.onCommit);
  const onEnterPastEndRef = useRef(options.onEnterPastEnd);
  useEffect(() => {
    isEditableRef.current = options.isEditable;
    onFillDownRef.current = options.onFillDown;
    onCommitRef.current = options.onCommit;
    onEnterPastEndRef.current = options.onEnterPastEnd;
  });

  const canEdit = useCallback(
    (r: number, c: number) => isEditableRef.current?.(r, c) ?? true,
    [],
  );

  const setSelection = useCallback(
    (
      next:
        | SheetSelection
        | null
        | ((prev: SheetSelection | null) => SheetSelection | null),
    ) => {
      const value = typeof next === 'function' ? next(selectionRef.current) : next;
      selectionRef.current = value;
      setSelectionState(value);
    },
    [],
  );

  const focusCoord = useCallback(
    (co: Coord, extend = false) => {
      if (!inBounds(co, rows, cols)) return;
      setFocused(co);
      const prev = selectionRef.current;
      setSelection(extend && prev ? { anchor: prev.anchor, focus: co } : cellSelection(co));
      const el = cellRefs.current.get(cellKey(co.r, co.c));
      if (el) {
        programmatic.current = true;
        el.focus();
        // `<select>`-д `.select()` байхгүй — зөвхөн текст талбарын агуулгыг тэмдэглэнэ.
        if (!extend && 'select' in el) el.select();
      }
    },
    [rows, cols, setSelection],
  );

  /** Мөр нэмэгдсэний дараа focus хийхийг хүсэх (шууд биш, дараагийн рендэрт). */
  const requestFocus = useCallback((co: Coord) => {
    pendingFocus.current = co;
  }, []);

  // Хүснэгтийн хэмжээ өөрчлөгдмөгц (мөр нэмэгдсэн) хүлээгдэж буй focus-ыг барина.
  useEffect(() => {
    const pf = pendingFocus.current;
    if (!pf) return;
    pendingFocus.current = null;
    if (inBounds(pf, rows, cols)) focusCoord(pf);
  }, [rows, cols, focusCoord]);

  /** (dr,dc) чиглэлд ЗАСАГДАХ дараагийн нүдийг хайна (засагдахгүйг алгасана). */
  const findEditable = useCallback(
    (from: Coord, dr: number, dc: number): Coord | null => {
      let r = from.r + dr;
      let c = from.c + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols) {
        if (canEdit(r, c)) return { r, c };
        r += dr;
        c += dc;
      }
      return null;
    },
    [rows, cols, canEdit],
  );

  /** Tab-ын хавтгай алхам: мөр→мөр давж, засагдахгүй нүдийг алгасана. */
  const flatStep = useCallback(
    (from: Coord, dir: 1 | -1): Coord | null => {
      if (cols <= 0 || rows <= 0) return null;
      const last = rows * cols - 1;
      let idx = from.r * cols + from.c + dir;
      while (idx >= 0 && idx <= last) {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        if (canEdit(r, c)) return { r, c };
        idx += dir;
      }
      return null;
    },
    [rows, cols, canEdit],
  );

  /**
   * Shift+сум — сонголтын ирмэгийг НЭГ алхам хөдөлгөнө (засагдахгүй нүдийг
   * алгасахгүй: сонголт нь тэгш өнцөгт, дотор нь түгжээтэй нүд байж болно).
   * Ирмэгийг event-ийн координатаас биш `selection.focus`-оос авдаг — учир нь
   * зорилтот нүд засагдахгүй үед DOM focus хөдөлдөггүй ч сонголт үргэлжлэн
   * тэлэх ёстой.
   */
  const extendEdge = useCallback(
    (co: Coord, dr: number, dc: number) => {
      const edge = selectionRef.current?.focus ?? co;
      const next = { r: edge.r + dr, c: edge.c + dc };
      if (!inBounds(next, rows, cols)) return;
      focusCoord(next, true);
    },
    [rows, cols, focusCoord],
  );

  const onCellKeyDown = useCallback(
    (e: React.KeyboardEvent<SheetCellElement>, co: Coord) => {
      const el = e.currentTarget;
      // Ctrl/Cmd+D — доош дүүргэх.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        onFillDownRef.current?.();
        return;
      }
      // Ctrl/Cmd+C|V|X|A — clipboard event-ууд өөрсдөө барина (table onCopy/…).
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) {
        return;
      }
      switch (e.key) {
        case 'Enter': {
          e.preventDefault();
          if (e.shiftKey) {
            const up = findEditable(co, -1, 0);
            if (up) focusCoord(up);
            return;
          }
          const down = findEditable(co, 1, 0);
          if (down) {
            focusCoord(down);
            return;
          }
          // Доор засагдах мөр алга — хэрэглэгч шинэ мөр нэмэхийг хүсч байна.
          if (onEnterPastEndRef.current) {
            pendingFocus.current = { r: co.r + 1, c: co.c };
            onEnterPastEndRef.current(co);
          }
          return;
        }
        case 'Tab': {
          e.preventDefault();
          const next = flatStep(co, e.shiftKey ? -1 : 1);
          if (next) focusCoord(next);
          return;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (e.shiftKey) extendEdge(co, -1, 0);
          else {
            const up = findEditable(co, -1, 0);
            if (up) focusCoord(up);
          }
          return;
        }
        case 'ArrowDown': {
          e.preventDefault();
          if (e.shiftKey) extendEdge(co, 1, 0);
          else {
            const down = findEditable(co, 1, 0);
            if (down) focusCoord(down);
          }
          return;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Текст нүдэнд caret хилд хүрээгүй бол ердийн caret хөдөлгөөн.
          if (!atCaretBoundary(el, e.key)) return;
          e.preventDefault();
          const dc = e.key === 'ArrowLeft' ? -1 : 1;
          if (e.shiftKey) extendEdge(co, 0, dc);
          else {
            const next = findEditable(co, 0, dc);
            if (next) focusCoord(next);
          }
          return;
        }
        case 'Escape': {
          el.blur();
          onCommitRef.current?.();
          return;
        }
        default:
          return;
      }
    },
    [findEditable, flatStep, focusCoord, extendEdge],
  );

  /** `ref={registerCell(r, c)}` — нүдний элементийг registry-д барина. */
  const registerCell = useCallback(
    (r: number, c: number) => (el: SheetCellElement | null) => {
      const k = cellKey(r, c);
      if (el) cellRefs.current.set(k, el);
      else cellRefs.current.delete(k);
    },
    [],
  );

  const onCellFocus = useCallback(
    (co: Coord) => {
      // Программаар focus хийсэн бол (focusCoord) сонголтыг тэр аль хэдийн тавьсан.
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      // Хэрэглэгч гараар дарсан — тухайн нэг нүдийг сонго.
      setFocused(co);
      setSelection(cellSelection(co));
    },
    [setSelection],
  );

  const isSelected = useCallback(
    (r: number, c: number): boolean => isInSelection(selection, r, c),
    [selection],
  );

  return {
    focused,
    selection,
    setSelection,
    registerCell,
    onCellKeyDown,
    onCellFocus,
    focusCoord,
    requestFocus,
    isSelected,
  };
}
