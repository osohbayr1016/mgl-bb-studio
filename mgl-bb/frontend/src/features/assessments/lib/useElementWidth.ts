import { useEffect, useState } from 'react';

/** ResizeObserver-оор элементийн өргөнийг хянана (график legend-д). */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>, fallback = 640): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
