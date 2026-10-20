/* ЦОНХ ДОТОРХ БУЦААХ / ДАХИН ХИЙХ (Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z) — эзэн 2026-10-09.
 *
 * Засварлагчийн загварыг (цэвэр, immutable) алхам бүрээр түүхэнд хадгална.  Нэг талбарт дараалан бичихэд (`coalesce`
 * түлхүүр ижил) нэг алхам болно — үсэг бүрийг тусад нь буцаахгүй.
 *
 * `useUndoHotkeys` — цонх нээлттэй үед товчлолыг WINDOW түвшинд (capture) сонсож хөтчийн оролтын өөрийн undo-г ДАРНА
 * (эс бөгөөс Ctrl+Z нь зөвхөн тэр нүдний бичвэрийг буцааж, загвартай зөрнө).  Элементийн `onKeyDown` хангалтгүй:
 * Radix Select хаагдсаны дараа фокус body руу очдог тул тэр үед дарсан Ctrl+Z цонхонд хүрдэггүй байв (E2E-д хэмжсэн). */
import { useCallback, useEffect, useRef, useState } from 'react';

const LIMIT = 100;

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface UndoHistory<T> {
  state: T;
  /** Шинэ төлөв.  `coalesce` өгвөл өмнөх алхам ижил түлхүүртэй үед нэг алхам болно (бичих үед). */
  set: (next: T | ((cur: T) => T), opts?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoHistory<T>(initial: T | (() => T)): UndoHistory<T> {
  const [h, setH] = useState<History<T>>(() => ({
    past: [],
    present: typeof initial === 'function' ? (initial as () => T)() : initial,
    future: [],
  }));
  const lastKey = useRef<string | null>(null);

  const set = useCallback((next: T | ((cur: T) => T), opts?: { coalesce?: string }) => {
    const key = opts?.coalesce ?? null;
    // ⚠️ Нэгтгэх эсэхийг updater-ээс ГАДНА шийднэ: StrictMode-д updater хоёр удаа ажилладаг тул дотор нь ref өөрчилбөл
    // хоёр дахь дуудалт «өмнөх алхамтай ижил түлхүүр» гэж үзээд алхам бүрийг нэгтгэж, Ctrl+Z бүх засварыг нэг дор буцаана.
    const sameKey = key !== null && key === lastKey.current;
    lastKey.current = key;
    setH((cur) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(cur.present) : next;
      if (Object.is(value, cur.present)) return cur;
      const merge = sameKey && cur.past.length > 0;
      return {
        past: merge ? cur.past : [...cur.past, cur.present].slice(-LIMIT),
        present: value,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    lastKey.current = null;
    setH((cur) => {
      const prev = cur.past[cur.past.length - 1];
      if (prev === undefined) return cur;
      return { past: cur.past.slice(0, -1), present: prev, future: [cur.present, ...cur.future] };
    });
  }, []);

  const redo = useCallback(() => {
    lastKey.current = null;
    setH((cur) => {
      const nxt = cur.future[0];
      if (nxt === undefined) return cur;
      return { past: [...cur.past, cur.present], present: nxt, future: cur.future.slice(1) };
    });
  }, []);

  return { state: h.present, set, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

/**
 * Ctrl/⌘+Z = буцаах, Ctrl/⌘+Shift+Z ба Ctrl+Y = дахин хийх — бүрэлдэхүүн mount болсон хугацаанд (цонх нээлттэй).
 * `onHotkey` — товчлол ажиллахын ӨМНӨ (жишээ нь бичиж буй талбарын түр бичвэрийг цэвэрлэх).
 * Өөр баталгаажуулах цонх (alertdialog) дээгүүр нээлттэй үед ажиллахгүй.
 */
export function useUndoHotkeys(undo: () => void, redo: () => void, onHotkey?: () => void, enabled = true): void {
  const before = useRef(onHotkey);
  useEffect(() => {
    before.current = onHotkey;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      const k = e.key.toLowerCase();
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y';
      if (!isUndo && !isRedo) return;
      e.preventDefault();
      before.current?.();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo, enabled]);
}
