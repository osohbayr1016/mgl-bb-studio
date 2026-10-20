import { useCallback, useEffect, useImperativeHandle, useRef, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { cropCanvasToInk } from '@/shared/lib/trimInk';

/**
 * Гарын үсэг зурах талбар — хуруу / stylus / mouse.
 *
 * Зураасыг canvas-ын өргөнд НОРМАЛЧЛАГДСАН вектор цэгээр хадгалдаг тул утас эргэх,
 * хөтөч resize хийх үед зураг бүдгэрэхгүй/арилахгүй дахин зурагдана; экспортын
 * зузаан нь дэлгэцийн хэмжээнээс үл хамаарна (өөр төхөөрөмж дээр зурсан ч ижил).
 *
 * Хуудас гүйлгэгдэх ёстой: `touch-action: none` зөвхөн ЭНЭ canvas дээр — талбарын
 * гадна хуруугаар гүйлгэхэд хуудас хэвийн хөдөлнө.  Нэг pointer л зурна (алганы
 * хоёр дахь хүрэлт үл тоогдоно).
 *
 * Буцаах / дахин хийх (2026-10-12, эзний хүсэлт): зураас бүр (мөн «Арилгах») нэг алхам;
 * Ctrl+Z / ⌘Z буцаана, Ctrl+Y / Ctrl+Shift+Z / ⌘⇧Z дахин хийнэ — фокус бичих талбарт
 * (нэр, албан тушаал) байвал хөтчийн өөрийн undo хэвээр.  Утсанд товчлуургүй тул дуудагч
 * `undo()` / `redo()`-г товчоор дуудна (`onHistoryChange` идэвхтэй эсэхийг хэлнэ).
 */

export interface SignaturePadHandle {
  clear: () => void;
  /** Сүүлийн алхмыг буцаана (зураас эсвэл «Арилгах»); буцаах юм байхгүй бол false. */
  undo: () => boolean;
  /** Буцаасан алхмыг сэргээнэ. */
  redo: () => boolean;
  /** Бодит зураас байгаа эсэх (санамсаргүй товшилтыг тооцохгүй). */
  hasInk: () => boolean;
  /** Тайрсан PNG data URL (цагаан дэвсгэртэй, портал/профайлын гарын үсэгтэй ижил хэлбэр). */
  toPngDataUrl: () => string | null;
}

type Pt = { x: number; y: number }; // x,y — canvas өргөнд харьцуулсан (0..1)
const LINE_NORM = 0.0065; // зураасны зузаан = өргөний 0.65%
const MIN_LINE_PX = 2.4;
/** Нийт бэхний урт (өргөнд харьцуулсан) энэ хэмжээнээс бага бол «хоосон». */
const MIN_INK_NORM = 0.06;
const EXPORT_WIDTH = 1000;
/** Буцаах түүхийн дээд урт (зураас бүр нэг алхам). */
const MAX_HISTORY = 200;

/** Фокус бичих талбарт байвал Ctrl+Z нь тэр талбарын бичвэрийг буцаах ёстой. */
function typingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

function inkLength(strokes: Pt[][]): number {
  let total = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) total += Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
  }
  return total;
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Pt[][], w: number, lineWidth: number) {
  ctx.strokeStyle = '#111827';
  ctx.fillStyle = '#111827';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (s.length === 0) continue;
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0]!.x * w, s[0]!.y * w, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0]!.x * w, s[0]!.y * w);
    for (let i = 1; i < s.length - 1; i++) {
      const mx = ((s[i]!.x + s[i + 1]!.x) / 2) * w;
      const my = ((s[i]!.y + s[i + 1]!.y) / 2) * w;
      ctx.quadraticCurveTo(s[i]!.x * w, s[i]!.y * w, mx, my);
    }
    const last = s[s.length - 1]!;
    ctx.lineTo(last.x * w, last.y * w);
    ctx.stroke();
  }
}

export function SignaturePad({
  ref,
  disabled,
  onInkChange,
  onHistoryChange,
  label,
  className,
}: {
  ref?: Ref<SignaturePadHandle>;
  disabled?: boolean;
  onInkChange?: (hasInk: boolean) => void;
  /** Буцаах / дахин хийх боломжтой эсэх өөрчлөгдөхөд (товчны идэвхтэй байдал). */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  label: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Pt[][]>([]);
  const active = useRef<{ id: number; stroke: Pt[] } | null>(null);
  const inkState = useRef(false);
  // Алхам бүрийн ӨМНӨХ төлөв (зураасны массивын хуулбар — зураас өөрөө өөрчлөгдөхгүй тул хямд).
  const undoStack = useRef<Pt[][][]>([]);
  const redoStack = useRef<Pt[][][]>([]);
  const historyState = useRef({ canUndo: false, canRedo: false });

  const cssSize = () => {
    const c = canvasRef.current;
    if (!c) return { w: 0, h: 0 };
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const { w, h } = cssSize();
    if (w < 2 || h < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawStrokes(ctx, strokes.current, w, Math.max(MIN_LINE_PX, w * LINE_NORM));
  }, []);

  const syncInk = useCallback(() => {
    const has = inkLength(strokes.current) >= MIN_INK_NORM;
    if (has !== inkState.current) {
      inkState.current = has;
      onInkChange?.(has);
    }
  }, [onInkChange]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    redraw();
    const ro = new ResizeObserver(() => redraw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw]);

  const syncHistory = useCallback(() => {
    const next = { canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 };
    if (next.canUndo !== historyState.current.canUndo || next.canRedo !== historyState.current.canRedo) {
      historyState.current = next;
      onHistoryChange?.(next);
    }
  }, [onHistoryChange]);

  /** Шинэ алхмын өмнө одоогийн төлвийг хадгална; шинэ алхам «дахин хийх»-ийг арилгана. */
  const pushHistory = useCallback(() => {
    undoStack.current.push(strokes.current.slice());
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const undo = useCallback((): boolean => {
    if (active.current || undoStack.current.length === 0) return false;
    redoStack.current.push(strokes.current);
    strokes.current = undoStack.current.pop()!;
    redraw();
    syncInk();
    syncHistory();
    return true;
  }, [redraw, syncInk, syncHistory]);

  const redo = useCallback((): boolean => {
    if (active.current || redoStack.current.length === 0) return false;
    undoStack.current.push(strokes.current);
    strokes.current = redoStack.current.pop()!;
    redraw();
    syncInk();
    syncHistory();
    return true;
  }, [redraw, syncInk, syncHistory]);

  // Ctrl+Z / ⌘Z, Ctrl+Y / Ctrl+Shift+Z — хуудсан дээр хаана ч (бичих талбараас бусад).
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      if (k !== 'z' && k !== 'y') return;
      const done = isRedo ? redo() : undo();
      if (done) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, undo, redo]);

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        if (strokes.current.length > 0) pushHistory();
        strokes.current = [];
        active.current = null;
        redraw();
        syncInk();
        syncHistory();
      },
      undo,
      redo,
      hasInk: () => inkLength(strokes.current) >= MIN_INK_NORM,
      toPngDataUrl() {
        if (inkLength(strokes.current) < MIN_INK_NORM) return null;
        const { w, h } = cssSize();
        if (w < 2 || h < 2) return null;
        const out = document.createElement('canvas');
        out.width = EXPORT_WIDTH;
        out.height = Math.max(2, Math.round(EXPORT_WIDTH * (h / w)));
        const ctx = out.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
        drawStrokes(ctx, strokes.current, EXPORT_WIDTH, EXPORT_WIDTH * LINE_NORM);
        cropCanvasToInk(out);
        return out.toDataURL('image/png');
      },
    }),
    [redraw, syncInk, syncHistory, pushHistory, undo, redo],
  );

  const point = (e: ReactPointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || active.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke = [point(e)];
    pushHistory();
    strokes.current = [...strokes.current, stroke];
    active.current = { id: e.pointerId, stroke };
    redraw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const r = e.currentTarget.getBoundingClientRect();
    const list = events.length > 0 ? events : [native];
    for (const ev of list) a.stroke.push({ x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.width });
    redraw();
  };

  const end = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    syncInk();
    syncHistory();
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={
        // touch-none: зөвхөн зурах талбар дээр браузерын гүйлгэлт/zoom-ыг хаана.
        'block w-full touch-none select-none rounded-xl bg-white [-webkit-touch-callout:none] ' +
        'aspect-[3/2] min-h-[200px] sm:aspect-[5/2] ' +
        (className ?? '')
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
