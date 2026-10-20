import { useEffect, useRef, type CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

/**
 * CursorSpotlight — курсорыг дагасан зөөлөн primary гэрэлтэлт, бүх апп дээр.
 * Stat картуудын `useSpotlight`-ийн вэб-хэмжээний хувилбар: viewport-ийг бүрэн
 * халхалсан `fixed`, `pointer-events-none` давхарга бөгөөд `--mx`/`--my` CSS
 * хувьсагчаар radial-gradient-ийг курсор луу зөөнө. reduced-motion үед идэвхгүй.
 * Тунгалаг (~6%) тул контентыг бүдгэрүүлэхгүй. z-[55] — chrome/sidebar (z-50)
 * дээгүүр гэрэлтэж зүүн самбар дээр ч тусна; toast (z-100) доор нь үлдэнэ.
 *
 * ⚠️ Мэдрэгчтэй төхөөрөмж дээр ОГТ render хийхгүй.  Курсор байхгүй тул
 * гэрэлтэлт нь утга учиргүй боловч хуруугаар гүйлгэх бүрд `pointermove`
 * хөөрч, кадр тутамд rAF + CSS хувьсагч бичилт хийгддэг байсан — яг
 * гүйлгэлт хамгийн зөөлөн байх ёстой мөчид үрэгдэл үүсгэнэ.
 */
export function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const hasCursor = useMediaQuery('(hover: hover) and (pointer: fine)');
  const enabled = !reduce && hasCursor;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--mx', `${e.clientX}px`);
        el.style.setProperty('--my', `${e.clientY}px`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[55]"
      style={
        {
          '--mx': '50vw',
          '--my': '50vh',
          background:
            'radial-gradient(600px circle at var(--mx) var(--my), hsl(var(--primary) / 0.06), transparent 70%)',
        } as CSSProperties
      }
    />
  );
}
