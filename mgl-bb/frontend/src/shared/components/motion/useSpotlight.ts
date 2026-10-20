/**
 * useSpotlight — pointer-tracking radial glow. Буцаах `ref`-ийг card элемент
 * дээр, `onPointerMove`-ийг түүний onPointerMove-д тавьж, CSS-д
 * `radial-gradient(... at var(--mx) var(--my) ...)` ашиглана. reduced-motion
 * үед идэвхгүй.
 *
 * Жишээ:
 *   const { ref, onPointerMove } = useSpotlight<HTMLDivElement>();
 *   <div ref={ref} onPointerMove={onPointerMove}
 *        className="relative before:absolute before:inset-0 before:opacity-0
 *                   hover:before:opacity-100 before:[background:radial-gradient(
 *                   200px_circle_at_var(--mx)_var(--my),hsl(var(--primary)/0.15),transparent)]" />
 */
import { useRef, useCallback, type PointerEvent } from 'react';
import { useReducedMotion } from 'motion/react';

export function useSpotlight<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();

  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      const el = ref.current;
      if (reduce || !el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    },
    [reduce],
  );

  return { ref, onPointerMove };
}
