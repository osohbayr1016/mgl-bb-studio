/**
 * Excel-хүснэгтийн ХУУЛАХ / ТАСЛАХ / БУУЛГАХ + ДООШ ДҮҮРГЭХ (ерөнхий).
 *
 * Синхрон DOM event-ээр (`clipboardData`) TSV ажиллана — Excel-ээс шууд буулгаж
 * болно (Excel `text/plain`-д tab/мөр-таслалтай TSV тавьдаг). Бүх бичилт НЭГ
 * `writeCells(patches)` дуудалтаар явна (50 нүд буулгах = 1 шинэчлэлт), дараа нь
 * нэг удаа `onCommit()`.
 *
 * Гарал үүсэл: features/quotes/components/grid/useGridClipboard.ts. ЯЛГАА нь энэ
 * хувилбар `QuoteData`/`GridColumn`/`GridLineRow` мэддэггүй — нүдийг зөвхөн
 * `{r,c}`-ээр уншиж/бичих callback-аар ажиллана.
 *
 * ⚠️ Нэг нүд сонгогдсон үед copy/cut-ыг ЗОРИУДААР барихгүй — input-ийн default
 * хуулалт (нүд доторх текстийн хэсэг) ажиллана. Энэ нь хуучин зан төлөв бөгөөд
 * хэрэглэгчид нэг нүдний хэсэгчилсэн текстийг хуулж чаддаг байхад чухал.
 *
 * ⚠️ `ensureRows` болон `writeCells` хоёулаа НЭГ event дотор дараалан
 * дуудагдана. Тиймээс дуудагч тал хоёуланг нь ФУНКЦИОНАЛЬ шинэчлэлт
 * (`setData((prev) => …)`) хэлбэрээр хэрэгжүүлэх ёстой — эс бөгөөс хоёр дахь нь
 * эхнийхийг дарж бичнэ.
 */
import { useCallback } from 'react';
import {
  clampRect,
  isSingleCell,
  selectionRect,
  type Coord,
  type SheetSelection,
} from '@/shared/sheet/coords';

/** Нэг нүдний бичилт. `value` үргэлж түүхий текст (хөрвүүлэлт дуудагч талд). */
export interface SheetCellPatch {
  r: number;
  c: number;
  value: string;
}

export interface UseSheetClipboardOptions {
  /** Хүснэгтийн мөрийн тоо. */
  rows: number;
  /** Хүснэгтийн баганы тоо. */
  cols: number;
  selection: SheetSelection | null;
  focused: Coord | null;
  /** Нүдний түүхий текст (хоосон нүд → ''). */
  readCell: (r: number, c: number) => string;
  /** Олон нүдийг НЭГ immutable шинэчлэлтээр бичнэ. */
  writeCells: (patches: SheetCellPatch[]) => void;
  /**
   * Хүснэгтэд ДОР ХАЯЖ `n` мөр байхыг баталгаажуулна (нийт мөрийн тоо, нэмэх
   * мөрийн тоо БИШ). Өгөөгүй бол буулгасан блок одоогийн `rows`-оор тасарна.
   */
  ensureRows?: (n: number) => void;
  /** Нүд засагдах эсэх. Өгөөгүй бол бүх нүд засагдана гэж үзнэ. */
  isEditable?: (r: number, c: number) => boolean;
  /** Бичилт бүрийн дараа нэг удаа (autosave flush). */
  onCommit?: () => void;
}

export function useSheetClipboard(options: UseSheetClipboardOptions) {
  const {
    rows,
    cols,
    selection,
    focused,
    readCell,
    writeCells,
    ensureRows,
    isEditable,
    onCommit,
  } = options;

  const canEdit = useCallback(
    (r: number, c: number) => isEditable?.(r, c) ?? true,
    [isEditable],
  );

  /** Сонголт байхгүй ч focus-той нүд байвал түүнийг нэг нүдний сонголт гэж үзнэ. */
  const effectiveSel = useCallback(
    (): SheetSelection | null =>
      selection ?? (focused ? { anchor: focused, focus: focused } : null),
    [selection, focused],
  );

  const onCopy = useCallback(
    (e: React.ClipboardEvent) => {
      const sel = effectiveSel();
      if (!sel) return;
      // Нэг нүд бол input-ийн default хуулалтыг зөвшөөр (нүд доторх текст).
      if (isSingleCell(sel)) return;
      const { minR, maxR, minC, maxC } = clampRect(selectionRect(sel), rows, cols);
      const lines: string[] = [];
      for (let r = minR; r <= maxR; r += 1) {
        const cells: string[] = [];
        for (let c = minC; c <= maxC; c += 1) cells.push(readCell(r, c));
        lines.push(cells.join('\t'));
      }
      e.clipboardData.setData('text/plain', lines.join('\n'));
      e.preventDefault();
    },
    [effectiveSel, rows, cols, readCell],
  );

  /** Сонгогдсон тэгш өнцөгтийн ЗАСАГДАХ нүднүүдийг хоослоно. */
  const clearRect = useCallback(() => {
    const sel = effectiveSel();
    if (!sel) return;
    const { minR, maxR, minC, maxC } = clampRect(selectionRect(sel), rows, cols);
    const patches: SheetCellPatch[] = [];
    for (let r = minR; r <= maxR; r += 1) {
      for (let c = minC; c <= maxC; c += 1) {
        if (canEdit(r, c)) patches.push({ r, c, value: '' });
      }
    }
    if (patches.length === 0) return;
    writeCells(patches);
    onCommit?.();
  }, [effectiveSel, rows, cols, canEdit, writeCells, onCommit]);

  const onCut = useCallback(
    (e: React.ClipboardEvent) => {
      const sel = effectiveSel();
      if (!sel) return;
      if (isSingleCell(sel)) return; // нэг нүд → default
      onCopy(e);
      clearRect();
    },
    [effectiveSel, onCopy, clearRect],
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const start = focused ?? selection?.anchor;
      if (!start) return;
      const text = e.clipboardData.getData('text/plain');
      if (text == null || text === '') return;
      e.preventDefault();

      const lines = text.replace(/\r/g, '').split('\n');
      while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const matrix = lines.map((line) => line.split('\t'));

      // Блок доошоо хэтэрвэл эхлээд мөр нэмүүлнэ (нийт хэрэгтэй мөрийн тоо).
      const needed = start.r + matrix.length;
      let rowLimit = rows;
      if (needed > rows && ensureRows) {
        ensureRows(needed);
        rowLimit = needed;
      }

      const patches: SheetCellPatch[] = [];
      for (let i = 0; i < matrix.length; i += 1) {
        const r = start.r + i;
        if (r >= rowLimit) break;
        const line = matrix[i] ?? [];
        for (let j = 0; j < line.length; j += 1) {
          const c = start.c + j;
          if (c >= cols) break;
          // Дөнгөж үүсгэсэн мөрүүд (r >= rows) одоогийн рендэрт байхгүй тул
          // isEditable тэднийг мэдэхгүй — шалгалтыг зөвхөн одоо байгаа мөрд.
          if (r < rows && !canEdit(r, c)) continue;
          patches.push({ r, c, value: line[j] ?? '' });
        }
      }
      if (patches.length === 0 && rowLimit === rows) return;
      writeCells(patches);
      onCommit?.();
    },
    [focused, selection, rows, cols, ensureRows, canEdit, writeCells, onCommit],
  );

  /** Сонголтын ЭХНИЙ мөрийн утгуудыг доод мөрүүдэд хуулна (Ctrl/Cmd+D). */
  const fillDown = useCallback(() => {
    const sel = effectiveSel();
    if (!sel) return;
    const { minR, maxR, minC, maxC } = clampRect(selectionRect(sel), rows, cols);
    if (maxR <= minR) return;
    const patches: SheetCellPatch[] = [];
    for (let c = minC; c <= maxC; c += 1) {
      const value = readCell(minR, c);
      for (let r = minR + 1; r <= maxR; r += 1) {
        if (canEdit(r, c)) patches.push({ r, c, value });
      }
    }
    if (patches.length === 0) return;
    writeCells(patches);
    onCommit?.();
  }, [effectiveSel, rows, cols, readCell, canEdit, writeCells, onCommit]);

  return { onCopy, onCut, onPaste, clearRect, fillDown };
}
