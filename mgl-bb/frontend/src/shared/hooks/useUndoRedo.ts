/**
 * Энгийн undo/redo стек — тогтмол (immutable) төлөвт зориулав.
 *
 * Зарчим: төлөв бүр ШИНЭ объект үүсгэдэг (үнийн саналын `WorkbookDoc` тийм) тул
 * түүх нь зөвхөн заагчийн массив — гүн хуулбар хийхгүй.
 *
 * ⚠️ Санах ой: элемент бүр бүтэн баримт тул `limit`-ээр хязгаарлана. Хамгийн
 * хуучин алхмууд чимээгүй хаягдана (Excel мөн адил хязгаартай).
 *
 * ⚠️ `useRef`-т хадгална, `useState`-д БИШ: undo/redo нь гар товчлуурын
 * боловсруулагч дотроос дуудагддаг ба тэр агшинд хамгийн сүүлийн түүх хэрэгтэй.
 * `useState` бол хуучирсан closure барих эрсдэлтэй. Товчнуудын идэвхтэй/идэвхгүй
 * байдалд `version` тоолуур дахин рендэр өдөөнө.
 */
import { useCallback, useRef, useState } from 'react';

export interface UndoRedo<T> {
  /** Өөрчлөлт хийхийн ӨМНӨХ төлөвийг түүхэнд бүртгэнэ (redo-г цэвэрлэнэ). */
  record: (prev: T) => void;
  /**
   * Нэг алхам буцаана. `current` нь ОДООГИЙН төлөв (redo стек рүү орно).
   * Буцаах алхам байхгүй бол `null`.
   */
  undo: (current: T) => T | null;
  /** Нэг алхам урагшилна. Байхгүй бол `null`. */
  redo: (current: T) => T | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Түүхийг бүрэн цэвэрлэнэ (жишээ нь өөр баримт ачаалахад). */
  reset: () => void;
}

export function useUndoRedo<T>(limit = 50): UndoRedo<T> {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  /**
   * Стекийн УРТЫГ рендэрт ашиглах хувилбар (товчийг идэвхгүй болгоход).
   * Рендэрийн үед `ref.current` унших нь хуучин утга өгч болзошгүй тул
   * (react-hooks/refs) уртыг state-д тусгаж толидог.
   */
  const [sizes, setSizes] = useState({ past: 0, future: 0 });
  const sync = useCallback(
    () => setSizes({ past: past.current.length, future: future.current.length }),
    [],
  );

  const record = useCallback(
    (prev: T) => {
      past.current.push(prev);
      if (past.current.length > limit) past.current.shift();
      // Шинэ салаа эхэлсэн тул урагшлах түүх утгагүй болно (стандарт зан төлөв).
      if (future.current.length > 0) future.current = [];
      sync();
    },
    [limit, sync],
  );

  const undo = useCallback(
    (current: T): T | null => {
      const prev = past.current.pop();
      if (prev === undefined) return null;
      future.current.push(current);
      sync();
      return prev;
    },
    [sync],
  );

  const redo = useCallback(
    (current: T): T | null => {
      const next = future.current.pop();
      if (next === undefined) return null;
      past.current.push(current);
      sync();
      return next;
    },
    [sync],
  );

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  return {
    record,
    undo,
    redo,
    canUndo: sizes.past > 0,
    canRedo: sizes.future > 0,
    reset,
  };
}
